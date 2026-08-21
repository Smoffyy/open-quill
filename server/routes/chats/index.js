import registerBrowseRoutes from './browse.js';
import registerCrudRoutes from './crud.js';
import registerMessageRoutes from './messages.js';
import registerInspectRoutes from './inspect.js';
import registerTransferRoutes from './transfer.js';

export default function registerChatRoutes(app) {
  registerBrowseRoutes(app);
  registerTransferRoutes(app);
  registerMessageRoutes(app);
  registerInspectRoutes(app);
  registerCrudRoutes(app);
}
