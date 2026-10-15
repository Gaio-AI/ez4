import { bundlePackage } from '../../../../tools/esbuild.mjs';

bundlePackage('src/main.ts', 'dist/main.mjs', 'esm');
bundlePackage('src/main.ts', 'dist/main.cjs', 'cjs');
bundlePackage('src/library.ts', 'dist/library.mjs', 'esm');
bundlePackage('src/library.ts', 'dist/library.cjs', 'cjs');
