import {Logger} from './types';

export const consoleLogger: Logger = {
    info: (message) => console.log(message),
    warn: (message) => console.warn(message),
    error: (message) => console.error(message),
};
