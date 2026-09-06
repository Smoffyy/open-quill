import { parentPort } from 'worker_threads';
import { hostEnvInfo } from './hostenv.js';

if (parentPort) parentPort.postMessage(hostEnvInfo());
