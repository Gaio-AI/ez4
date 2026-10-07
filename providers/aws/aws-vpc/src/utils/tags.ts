export type VpcTag = {
  key: string;
  value: string;
};

export const getTagFilter = ({ key, value }: VpcTag) => {
  return {
    Name: `tag:${key}`,
    Values: [value]
  };
};
