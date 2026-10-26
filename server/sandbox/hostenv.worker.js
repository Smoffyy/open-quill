import { parentPort } from 'worker_threads';
import { probeHostEnv } from './hostenv.js';

if (parentPort) parentPort.postMessage(probeHostEnv());