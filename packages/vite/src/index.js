import { transformSync } from '@babel/core';
import { createFilter } from '@rollup/pluginutils';
import prefreshBabelPlugin from '@prefresh/babel-plugin';

/** @returns {import('vite').Plugin} */
export default function prefreshPlugin(options = {}) {
  let shouldSkip = false;
  const filter = createFilter(options.include, options.exclude);

  return {
    name: 'prefresh',
    configResolved(config) {
      shouldSkip = config.command === 'build' || config.isProduction;
    },
    transform(code, id, ssr) {
      if (
        shouldSkip ||
        !/\.(t|j)sx?$/.test(id) ||
        id.includes('node_modules') ||
        id.includes('?worker') ||
        !filter(id) ||
        ssr
      )
        return;

      const parserPlugins = [
        'jsx',
        'classProperties',
        'classPrivateProperties',
        'classPrivateMethods',
        /\.tsx?$/.test(id) && 'typescript',
        ...(options.parserPlugins || []),
      ].filter(Boolean);

      const result = transform(code, id, parserPlugins);
      const hasReg = /\$RefreshReg\$\(/.test(result.code);
      const hasSig = /\$RefreshSig\$\(/.test(result.code);

      if (!hasSig && !hasReg) return code;

      const prelude = `
        ${'import'} '@prefresh/vite/runtime';
        ${'import'} { flushUpdates } from '@prefresh/vite/utils';

        let prevRefreshReg;
        let prevRefreshSig;

        if (import.meta.hot) {
          prevRefreshReg = self.$RefreshReg$ || (() => {});
          prevRefreshSig = self.$RefreshSig$ || (() => (type) => type);

          self.$RefreshReg$ = (type, id) => {
            self.__PREFRESH__.register(type, ${JSON.stringify(id)} + " " + id);
          }

          self.$RefreshSig$ = () => {
            let status = 'begin';
            let savedType;
            return (type, key, forceReset, getCustomHooks) => {
              if (!savedType) savedType = type;
              status = self.__PREFRESH__.sign(type || savedType, key, forceReset, getCustomHooks, status);
              return type;
            };
          };
        }
        `;

      if (hasSig && !hasReg) {
        return {
          code: `
            ${prelude}
            ${result.code}
          `,
          map: result.map,
        };
      }

      return {
        code: `
        ${prelude}

        ${result.code}

        if (import.meta.hot) {
          self.$RefreshReg$ = prevRefreshReg;
          self.$RefreshSig$ = prevRefreshSig;
          import.meta.hot.accept((m) => {
            try {
              flushUpdates();
            } catch (e) {
              self.location.reload();
            }
          });
        }
      `,
        map: result.map,
      };
    },
  };
}

const transform = (code, path, plugins) =>
  transformSync(code, {
    plugins: [[prefreshBabelPlugin, { skipEnvCheck: true }]],
    parserOpts: {
      plugins,
    },
    ast: false,
    sourceMaps: true,
    sourceFileName: path,
    configFile: false,
    babelrc: false,
  });
