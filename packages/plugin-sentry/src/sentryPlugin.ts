import type { GranitePluginCore } from '@granite-js/plugin-core';
import { noop } from 'es-toolkit';
import { extractSentryDebugId } from './extractSentryDebugId';
import { writeDebugIdInjectedSourcemap } from './injectSentryDebugId';
import { tryResolveHermesBundle } from './resolveHermesBundle';
import { createClientActions } from './sentryClientActions';
import { getSentryDebugIdSnippets } from './snippets';
import type { SentryPluginOptions, SentryPluginResult } from './types';

const PLUGIN_NAME = 'sentry-plugin';
const PLUGIN_SHIM: GranitePluginCore = { name: PLUGIN_NAME };

export const sentryPlugin = ({ enabled = true, ...options }: SentryPluginOptions = {}): GranitePluginCore => {
  if (enabled === false) {
    return PLUGIN_SHIM;
  }

  const { injectionScript, sourceMappingComment } = getSentryDebugIdSnippets();
  const sentryActions = createClientActions(options);

  return {
    name: PLUGIN_NAME,
    build: {
      order: 'post',
      handler: async function (config) {
        const sentryResults: SentryPluginResult[] = [];
        const files = config.buildResults.map(({ outfile, sourcemapOutfile }) => ({
          bundle: outfile,
          sourcemap: sourcemapOutfile,
        }));

        for (const file of files) {
          const { bundle, sourcemap } = file;
          const debugId = await extractSentryDebugId(bundle);

          if (debugId == null) {
            console.error('Cannot find Sentry Debug ID');
            continue;
          }

          const hermesBundle = tryResolveHermesBundle(bundle);
          const targetBundle = hermesBundle?.hbc ?? bundle;
          const targetSourcemap = hermesBundle?.sourcemap ?? sourcemap;

          await Promise.all([
            writeDebugIdInjectedSourcemap(sourcemap, debugId),
            hermesBundle?.sourcemap ? writeDebugIdInjectedSourcemap(hermesBundle?.sourcemap, debugId) : noop,
          ]);

          await sentryActions.uploadSourcemap(
            { root: config.cwd },
            {
              bundlePath: targetBundle,
              sourcemapPath: targetSourcemap,
            }
          );

          sentryResults.push({
            bundle,
            sourcemap,
            debugId,
          });
        }

        this.meta.sentry = sentryResults;
      },
    },
    config: {
      esbuild: {
        banner: {
          js: injectionScript,
        },
        footer: {
          js: sourceMappingComment,
        },
      },
    },
  };
};
