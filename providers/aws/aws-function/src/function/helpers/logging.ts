import { ApplicationLogLevel, SystemLogLevel } from '@aws-sdk/client-lambda';
import { LogLevel } from '@ez4/project';

export const getSystemLogLevel = (logLevel: LogLevel | undefined) => {
  switch (logLevel) {
    case LogLevel.Information:
      return SystemLogLevel.Info;

    case LogLevel.Debug:
      return SystemLogLevel.Debug;

    // Platform lines have no error level.
    default:
      return SystemLogLevel.Warn;
  }
};

export const getLogLevel = (logLevel: LogLevel) => {
  switch (logLevel) {
    case LogLevel.Information:
      return ApplicationLogLevel.Info;

    case LogLevel.Debug:
      return ApplicationLogLevel.Debug;

    case LogLevel.Error:
      return ApplicationLogLevel.Error;

    default:
    case LogLevel.Warning:
      return ApplicationLogLevel.Warn;
  }
};
