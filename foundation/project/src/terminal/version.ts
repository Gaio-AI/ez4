export const checkMinNodeVersion = () => {
  const [major, minor] = process.versions.node.split('.', 3).map((version) => {
    return parseInt(version, 10);
  });

  // Synchronous module hooks (`module.registerHooks`) arrived in Node v22.15.
  if (major < 22 || (major === 22 && minor < 15)) {
    console.error('❌ Node v22.15+ is required.');
    process.exit(1);
  }
};
