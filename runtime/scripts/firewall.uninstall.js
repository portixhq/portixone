import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const RULE_NAME = 'PortixOne Runtime';

execFileAsync('netsh.exe', ['advfirewall', 'firewall', 'delete', 'rule', `name=${RULE_NAME}`])
  .then(() => console.log('Firewall rule removed.'))
  .catch((error) => console.error('Could not remove firewall rule (it may not exist):', error.message));
