// Lambda runs every function in UTC, whatever the machine's time zone, so the emulated handlers and the tests that
// call them do too: a time read without a zone, as the Aurora Data API returns it, means the same thing in both.
export const useLambdaTimezone = () => {
  process.env.TZ = 'UTC';
};
