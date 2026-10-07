import { bundlePackage } from '../../../../tools/esbuild.mjs';

// The native driver trusts the RDS certificate bundle, inlined as text.
const options = {
  loader: {
    '.pem': 'text'
  }
};

// Default package.
bundlePackage('src/main.ts', 'dist/main.mjs', 'esm', options);
bundlePackage('src/main.ts', 'dist/main.cjs', 'cjs', options);

// Client package.
bundlePackage('src/client.ts', 'dist/client.mjs', 'esm', options);
bundlePackage('src/client.ts', 'dist/client.cjs', 'cjs', options);

// Client API package.
bundlePackage('src/client-api.ts', 'dist/client-api.mjs', 'esm', options);
bundlePackage('src/client-api.ts', 'dist/client-api.cjs', 'cjs', options);

// Client Native package.
bundlePackage('src/client-native.ts', 'dist/client-native.mjs', 'esm', options);
bundlePackage('src/client-native.ts', 'dist/client-native.cjs', 'cjs', options);
