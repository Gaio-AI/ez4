// Bucket names are global, and a deleted one can stay taken for a while (longer when the next
// bucket goes to another region), so each run creates its buckets under names of its own.
const runSuffix = Date.now().toString(36);

export const getBucketName = (name: string) => {
  return `ez4-test-${name}-${runSuffix}`;
};
