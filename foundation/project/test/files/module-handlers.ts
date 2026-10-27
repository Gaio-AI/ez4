export const resolveLater = async () => {
  await new Promise((resolve) => setTimeout(resolve, 5));

  return 'done';
};

export const rejectLater = async () => {
  await new Promise((resolve) => setTimeout(resolve, 5));

  throw new Error('handler failed');
};
