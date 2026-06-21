'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, spawnSync } = require('child_process');

const VERSION = '3.2.0';
const EXIT_SUCCESS = 0;
const EXIT_ERROR = 1;

// ==================== VALIDATION CONSTANTS ====================

const VALID_FILENAME_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;
const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
const SYSTEM_FILES = new Set(['logs.txt', 'history.txt', 'systemInfo.json', 'systemReport.json']);

// FIX-8: expanded sensitive key pattern to cover more common secret naming conventions
const SENSITIVE_ENV_KEY_PATTERN = /(token|password|passwd|pwd|secret|key|auth|credential|cred|cert|private|askpass|ipc|session|api|access|bearer|oauth|refresh)/i;

class SystemInfoCollector {
  constructor() {
    this.filesDir = path.join(__dirname, 'collected_files');
    this.maxFileSize = 10 * 1024 * 1024; // 10 MB
    this.ensureFilesDirectory();

    // FIX-5: derive log/history paths from this.filesDir (respects tmpdir fallback)
    this.logFilePath = path.join(this.filesDir, 'logs.txt');
    this.historyFilePath = path.join(this.filesDir, 'history.txt');
    this.backupsDir = path.join(this.filesDir, '.backups');

    // FIX-13: renamed from maxHistoryEntries to historyDisplayLimit for clarity
    this.historyDisplayLimit = 20;
    this.maxLogEntriesShown = 20;

    this.verboseMode = process.argv.includes('--verbose') || process.argv.includes('-v');

    // FIX-11: cache for collectSystemInfo() result
    this._systemInfoCache = null;
  }

  ensureFilesDirectory() {
    try {
      if (!fs.existsSync(this.filesDir)) {
        fs.mkdirSync(this.filesDir, { recursive: true, mode: 0o755 });
      }
      fs.accessSync(this.filesDir, fs.constants.W_OK);
    } catch (error) {
      console.error('❌ Error creating/accessing files directory:', error.message);
      this.filesDir = path.join(os.tmpdir(), 'system_info_collector_' + Date.now());
      try {
        fs.mkdirSync(this.filesDir, { recursive: true });
      } catch (fallbackError) {
        console.error('❌ Critical: Cannot create any directory for file operations');
      }
    }
  }

  // FIX-3: ensure backups directory exists
  ensureBackupsDirectory() {
    try {
      if (!fs.existsSync(this.backupsDir)) {
        fs.mkdirSync(this.backupsDir, { recursive: true, mode: 0o755 });
      }
    } catch (error) {
      if (this.verboseMode) console.error('[debug] Could not create backups dir:', error.message);
    }
  }

  // ==================== COLLECT SYSTEM INFORMATION ====================

  // FIX-11: cache result to avoid redundant execSync calls within one process
  collectSystemInfo() {
    if (this._systemInfoCache) return this._systemInfoCache;
    try {
      const systemInfo = {
        operatingSystem: this.safeGetOSType(),
        osVersion: this.safeGetOSVersion(),
        platform: this.safeGetPlatform(),
        architecture: this.safeGetArchitecture(),
        hostname: this.safeGetHostname(),
        nodeVersion: this.safeGetNodeVersion(),
        npmVersion: this.getNpmVersion(),
        pythonVersion: this.getPythonVersion(),
        homeDirectory: this.safeGetHomeDirectory(),
        cpuCores: this.safeGetCpuCores(),
        cpuModel: this.safeGetCpuModel(),
        cpuSpeedMHz: this.safeGetCpuSpeed(),
        perCoreCpu: this.verboseMode ? this.safeGetPerCoreCpu() : undefined,
        totalMemory: this.formatBytes(this.safeGetTotalMemory()),
        freeMemory: this.formatBytes(this.safeGetFreeMemory()),
        usedMemory: this.formatBytes(this.safeGetUsedMemory()),
        memoryUsagePercent: this.safeGetMemoryUsagePercent(),
        uptime: this.formatUptime(this.safeGetUptime()),
        environmentVariables: this.getSelectedEnvironmentVariables(),
        timestamp: new Date().toISOString(),
        userInfo: this.safeGetUserInfo()
      };
      this._systemInfoCache = systemInfo;
      return systemInfo;
    } catch (error) {
      console.error('❌ Error collecting system info:', error.message);
      return this.getDefaultSystemInfo();
    }
  }

  // ---- Safe getters with fallbacks ----

  safeGetOSType() {
    try { return os.type() || 'Unknown OS'; } catch (e) {
      if (this.verboseMode) console.error('[debug] safeGetOSType:', e.message);
      return 'Unknown OS';
    }
  }

  safeGetOSVersion() {
    try { return os.release() || 'Unknown Version'; } catch (e) {
      if (this.verboseMode) console.error('[debug] safeGetOSVersion:', e.message);
      return 'Unknown Version';
    }
  }

  safeGetPlatform() {
    try { return os.platform() || 'unknown'; } catch (e) {
      if (this.verboseMode) console.error('[debug] safeGetPlatform:', e.message);
      return 'unknown';
    }
  }

  safeGetArchitecture() {
    try { return os.arch() || 'unknown'; } catch (e) {
      if (this.verboseMode) console.error('[debug] safeGetArchitecture:', e.message);
      return 'unknown';
    }
  }

  safeGetHostname() {
    try { return os.hostname() || 'localhost'; } catch (e) {
      if (this.verboseMode) console.error('[debug] safeGetHostname:', e.message);
      return 'localhost';
    }
  }

  safeGetNodeVersion() {
    try { return process.version || 'Unknown'; } catch (e) {
      if (this.verboseMode) console.error('[debug] safeGetNodeVersion:', e.message);
      return 'Unknown';
    }
  }

  safeGetCpuCores() {
    try {
      const cpus = os.cpus();
      return (cpus && cpus.length > 0) ? cpus.length : 1;
    } catch (e) {
      if (this.verboseMode) console.error('[debug] safeGetCpuCores:', e.message);
      return 1;
    }
  }

  safeGetCpuModel() {
    try {
      const cpus = os.cpus();
      return (cpus && cpus[0] && cpus[0].model) ? cpus[0].model : 'Unknown CPU';
    } catch (e) {
      if (this.verboseMode) console.error('[debug] safeGetCpuModel:', e.message);
      return 'Unknown CPU';
    }
  }

  safeGetCpuSpeed() {
    try {
      const cpus = os.cpus();
      return (cpus && cpus[0] && cpus[0].speed) ? cpus[0].speed : 0;
    } catch (e) {
      if (this.verboseMode) console.error('[debug] safeGetCpuSpeed:', e.message);
      return 0;
    }
  }

  safeGetPerCoreCpu() {
    try {
      const cpus = os.cpus();
      return cpus.map((cpu, i) => ({ core: i, model: cpu.model, speedMHz: cpu.speed }));
    } catch (e) {
      if (this.verboseMode) console.error('[debug] safeGetPerCoreCpu:', e.message);
      return [];
    }
  }

  safeGetTotalMemory() {
    try {
      const total = os.totalmem();
      return total > 0 ? total : 0;
    } catch (e) {
      if (this.verboseMode) console.error('[debug] safeGetTotalMemory:', e.message);
      return 0;
    }
  }

  safeGetFreeMemory() {
    try {
      const free = os.freemem();
      return free >= 0 ? free : 0;
    } catch (e) {
      if (this.verboseMode) console.error('[debug] safeGetFreeMemory:', e.message);
      return 0;
    }
  }

  safeGetUsedMemory() {
    try {
      const total = this.safeGetTotalMemory();
      const free = this.safeGetFreeMemory();
      return Math.max(0, total - free);
    } catch (e) {
      if (this.verboseMode) console.error('[debug] safeGetUsedMemory:', e.message);
      return 0;
    }
  }

  safeGetMemoryUsagePercent() {
    try {
      const total = this.safeGetTotalMemory();
      const used = this.safeGetUsedMemory();
      if (total === 0) return '0%';
      return ((used / total) * 100).toFixed(2) + '%';
    } catch (e) {
      if (this.verboseMode) console.error('[debug] safeGetMemoryUsagePercent:', e.message);
      return 'Unknown';
    }
  }

  safeGetUptime() {
    try {
      const uptime = os.uptime();
      return uptime >= 0 ? uptime : 0;
    } catch (e) {
      if (this.verboseMode) console.error('[debug] safeGetUptime:', e.message);
      return 0;
    }
  }

  safeGetHomeDirectory() {
    try {
      const home = os.homedir();
      if (!home) {
        return process.env.HOME || process.env.USERPROFILE || 'Not Available';
      }
      return home;
    } catch (e) {
      if (this.verboseMode) console.error('[debug] safeGetHomeDirectory:', e.message);
      return process.env.HOME || process.env.USERPROFILE || 'Not Available';
    }
  }

  // NEWFIX-A: Use os.userInfo().username as primary source
  safeGetUserInfo() {
    try {
      const info = os.userInfo();
      return {
        username: info.username || process.env.USER || process.env.USERNAME || 'Unknown',
        uid: typeof info.uid === 'number' ? info.uid : 'N/A',
        gid: typeof info.gid === 'number' ? info.gid : 'N/A',
        shell: info.shell || 'Not Available'
      };
    } catch (e) {
      if (this.verboseMode) console.error('[debug] safeGetUserInfo:', e.message);
      return {
        username: process.env.USER || process.env.USERNAME || 'Unknown',
        uid: 'N/A',
        gid: 'N/A',
        shell: 'Not Available'
      };
    }
  }

  getDefaultSystemInfo() {
    return {
      operatingSystem: 'Unknown',
      osVersion: 'Unknown',
      platform: 'unknown',
      architecture: 'unknown',
      hostname: 'unknown',
      nodeVersion: process.version || 'Unknown',
      npmVersion: 'Unknown',
      pythonVersion: 'Unknown',
      homeDirectory: 'Not Available',
      cpuCores: 1,
      cpuModel: 'Unknown',
      cpuSpeedMHz: 0,
      totalMemory: '0 Bytes',
      freeMemory: '0 Bytes',
      usedMemory: '0 Bytes',
      memoryUsagePercent: '0%',
      uptime: '0d 0h 0m',
      environmentVariables: this.getSelectedEnvironmentVariables(),
      timestamp: new Date().toISOString(),
      userInfo: { username: 'Unknown', uid: 'N/A', gid: 'N/A', shell: 'N/A' }
    };
  }

  getNpmVersion() {
    try {
      const npmVersion = execSync('npm -v', {
        encoding: 'utf-8',
        timeout: 3000,  // FIX-perf: reduced from 5000ms
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
      return npmVersion || 'Unknown';
    } catch {
      const userAgent = process.env.npm_config_user_agent || '';
      const match = userAgent.match(/npm\/(\S+)/);
      return match ? match[1] : 'Unknown';
    }
  }

  // FIX-1: use spawnSync instead of execSync+shell:true — avoids shell injection
  // risk and properly separates stdout/stderr without ambiguity.
  // Python 2 prints "--version" to stderr; Python 3 uses stdout. spawnSync
  // captures both correctly via .stdout and .stderr fields.
  getPythonVersion() {
    for (const cmd of ['python', 'python3']) {
      try {
        const result = spawnSync(cmd, ['--version'], {
          encoding: 'utf-8',
          timeout: 3000  // FIX-perf: reduced from 5000ms
        });
        if (result.error) continue;
        // Python 2 → stderr, Python 3 → stdout
        const output = (result.stdout || result.stderr || '').trim();
        if (output) return output;
      } catch (e) {
        if (this.verboseMode) console.error('[debug] getPythonVersion attempt failed:', e.message);
      }
    }
    return 'Not Installed';
  }

  getSelectedEnvironmentVariables() {
    const selectedVars = ['PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'NODE_ENV', 'PWD'];
    const envVars = {};
    selectedVars.forEach(varName => {
      let value = process.env[varName] || 'Not Set';
      if (varName === 'PATH' && value !== 'Not Set') {
        value = this.formatPathForDisplay(value);
      }
      envVars[varName] = value;
    });
    return envVars;
  }

  formatPathForDisplay(value) {
    const entries = value.split(path.delimiter).filter(Boolean);
    if (this.verboseMode || entries.length <= 5) return value;
    const preview = entries.slice(0, 5).join(path.delimiter);
    return `${preview}${path.delimiter}... (${entries.length} entries total, run with --verbose for full PATH)`;
  }

  // NEWFIX-H: Added PB; FIX-2: handle singular '1 Byte'
  formatBytes(bytes) {
    try {
      if (bytes === null || bytes === undefined) return '0 Bytes';
      bytes = parseInt(bytes);
      if (isNaN(bytes) || bytes < 0) return '0 Bytes';
      if (bytes === 0) return '0 Bytes';
      // FIX-2: singular case
      if (bytes === 1) return '1 Byte';

      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
      const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
      if (i < 0) return bytes + ' Bytes';

      const result = Math.round((bytes / Math.pow(k, i)) * 100) / 100;
      return result + ' ' + sizes[i];
    } catch {
      return '0 Bytes';
    }
  }

  formatUptime(seconds) {
    try {
      if (seconds === null || seconds === undefined) return '0d 0h 0m';
      seconds = parseInt(seconds);
      if (isNaN(seconds) || seconds < 0) return '0d 0h 0m';

      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${days}d ${hours}h ${minutes}m`;
    } catch {
      return '0d 0h 0m';
    }
  }

  safeDisplay(value) {
    if (value === null || value === undefined) return 'Not Available';
    if (value === '') return 'Not Available';
    return String(value);
  }

  static get SECTION_FIELD_MAP() {
    return {
      os: ['operatingSystem', 'osVersion', 'platform', 'architecture', 'hostname', 'homeDirectory'],
      cpu: ['cpuModel', 'cpuCores', 'cpuSpeedMHz', 'perCoreCpu'],
      memory: ['totalMemory', 'usedMemory', 'freeMemory', 'memoryUsagePercent'],
      node: ['nodeVersion', 'npmVersion', 'pythonVersion'],
      env: ['environmentVariables'],
      user: ['userInfo']
    };
  }

  extractSection(info, sectionName) {
    const fields = SystemInfoCollector.SECTION_FIELD_MAP[sectionName] || [];
    const section = {};
    fields.forEach(field => {
      if (info[field] !== undefined) section[field] = info[field];
    });
    return section;
  }

  isSensitiveEnvKey(key) {
    return SENSITIVE_ENV_KEY_PATTERN.test(key);
  }

  // FIX-8: fully mask short secrets (≤8 chars) to avoid exposing most of the value
  maskValue(value) {
    const str = this.safeDisplay(value);
    if (str === 'Not Available' || str === 'Not Set') return str;
    if (str.length <= 8) return '****';
    return str.slice(0, 2) + '*'.repeat(Math.min(str.length - 4, 12)) + str.slice(-2);
  }

  getAllEnvironmentVariablesRedacted() {
    const result = {};
    try {
      Object.keys(process.env).sort().forEach(key => {
        const value = process.env[key];
        result[key] = this.isSensitiveEnvKey(key) ? this.maskValue(value) : value;
      });
    } catch (error) {
      console.log(`⚠️  Could not fully enumerate environment variables: ${error.message}`);
    }
    return result;
  }

  // ==================== DISPLAY (SECTIONED) ====================

  static get BOX_INNER_WIDTH() {
    return 60;
  }

  centerText(text, width) {
    const str = String(text);
    if (str.length >= width) return str.slice(0, width);
    const totalPad = width - str.length;
    const left = Math.floor(totalPad / 2);
    const right = totalPad - left;
    return ' '.repeat(left) + str + ' '.repeat(right);
  }

  printHeader(title = 'SYSTEM INFORMATION REPORT') {
    const width = SystemInfoCollector.BOX_INNER_WIDTH;
    console.log('\n');
    console.log('╔' + '═'.repeat(width) + '╗');
    console.log('║' + this.centerText(title, width) + '║');
    console.log('╚' + '═'.repeat(width) + '╝');
    console.log('');
  }

  printOSSection(info) {
    console.log('📊 OPERATING SYSTEM INFO:');
    console.log(`   • OS: ${this.safeDisplay(info.operatingSystem)} ${this.safeDisplay(info.osVersion)}`);
    console.log(`   • Platform: ${this.safeDisplay(info.platform)}`);
    console.log(`   • Architecture: ${this.safeDisplay(info.architecture)}`);
    console.log('');
  }

  printComputerSection(info) {
    console.log('💻 COMPUTER INFO:');
    console.log(`   • Hostname: ${this.safeDisplay(info.hostname)}`);
    console.log(`   • Home Directory: ${this.safeDisplay(info.homeDirectory)}`);
    console.log('');
  }

  printUserSection(info) {
    console.log('👤 USER INFO:');
    if (info.userInfo) {
      console.log(`   • Username: ${this.safeDisplay(info.userInfo.username)}`);
      console.log(`   • UID: ${this.safeDisplay(String(info.userInfo.uid))}`);
      console.log(`   • GID: ${this.safeDisplay(String(info.userInfo.gid))}`);
      console.log(`   • Shell: ${this.safeDisplay(info.userInfo.shell)}`);
    }
    console.log('');
  }

  printCPUSection(info) {
    console.log('⚙️  PROCESSOR INFO:');
    console.log(`   • CPU Model: ${this.safeDisplay(info.cpuModel)}`);
    console.log(`   • CPU Cores: ${this.safeDisplay(String(info.cpuCores))}`);
    console.log(`   • Clock Speed: ${this.safeDisplay(String(info.cpuSpeedMHz))}MHz`);
    if (this.verboseMode && Array.isArray(info.perCoreCpu)) {
      console.log('   • Per-core detail:');
      info.perCoreCpu.forEach(c => console.log(`      - Core ${c.core}: ${c.model} @ ${c.speedMHz}MHz`));
    } else {
      console.log('   ℹ Run with --verbose for per-core detail');
    }
    console.log('');
  }

  printMemorySection(info) {
    console.log('🧠 MEMORY INFO:');
    console.log(`   • Total Memory: ${this.safeDisplay(info.totalMemory)}`);
    console.log(`   • Used Memory: ${this.safeDisplay(info.usedMemory)}`);
    console.log(`   • Free Memory: ${this.safeDisplay(info.freeMemory)}`);
    console.log(`   • Memory Usage: ${this.safeDisplay(info.memoryUsagePercent)}`);
    console.log('');
  }

  printSoftwareSection(info) {
    console.log('🚀 SOFTWARE VERSIONS:');
    console.log(`   • Node.js: ${this.safeDisplay(info.nodeVersion)}`);
    console.log(`   • NPM: ${this.safeDisplay(info.npmVersion)}`);
    console.log(`   • Python: ${this.safeDisplay(info.pythonVersion)}`);
    console.log('');
  }

  printUptimeSection(info) {
    console.log('⏱️  SYSTEM UPTIME:');
    console.log(`   • ${this.safeDisplay(info.uptime)}`);
    console.log('');
  }

  printEnvSection(info) {
    console.log('🔐 ENVIRONMENT VARIABLES:');
    if (info.environmentVariables && typeof info.environmentVariables === 'object') {
      Object.entries(info.environmentVariables).forEach(([key, value]) => {
        const displayValue = this.safeDisplay(String(value));
        const truncated = displayValue.length > 90 ? displayValue.substring(0, 87) + '...' : displayValue;
        console.log(`   • ${key}: ${truncated}`);
      });
    }
    console.log('');
  }

  printTimestamp(info) {
    console.log(`📅 Timestamp: ${this.safeDisplay(info.timestamp)}`);
    console.log('\n');
  }

  displaySystemInfo(info, jsonMode = false) {
    if (!info) {
      console.log('❌ Could not collect system information.');
      return;
    }
    if (jsonMode) {
      console.log(JSON.stringify(info, null, 2));
      return;
    }
    this.printHeader();
    this.printOSSection(info);
    this.printComputerSection(info);
    this.printUserSection(info);
    this.printCPUSection(info);
    this.printMemorySection(info);
    this.printSoftwareSection(info);
    this.printUptimeSection(info);
    this.printEnvSection(info);
    this.printTimestamp(info);
  }

  showOSInfo(jsonMode = false) {
    const info = this.collectSystemInfo();
    if (jsonMode) { console.log(JSON.stringify(this.extractSection(info, 'os'), null, 2)); return; }
    this.printHeader('OPERATING SYSTEM DETAILS');
    this.printOSSection(info);
    this.printComputerSection(info);
  }

  showCPUInfo(jsonMode = false) {
    const info = this.collectSystemInfo();
    if (jsonMode) { console.log(JSON.stringify(this.extractSection(info, 'cpu'), null, 2)); return; }
    this.printHeader('PROCESSOR DETAILS');
    this.printCPUSection(info);
  }

  showMemoryInfo(jsonMode = false) {
    const info = this.collectSystemInfo();
    if (jsonMode) { console.log(JSON.stringify(this.extractSection(info, 'memory'), null, 2)); return; }
    this.printHeader('MEMORY DETAILS');
    this.printMemorySection(info);
  }

  showNodeInfo(jsonMode = false) {
    const info = this.collectSystemInfo();
    if (jsonMode) { console.log(JSON.stringify(this.extractSection(info, 'node'), null, 2)); return; }
    this.printHeader('RUNTIME VERSIONS');
    this.printSoftwareSection(info);
  }

  showEnvInfo(jsonMode = false) {
    const info = this.collectSystemInfo();
    if (jsonMode) { console.log(JSON.stringify(this.extractSection(info, 'env'), null, 2)); return; }
    this.printHeader('ENVIRONMENT VARIABLES (allowlisted)');
    this.printEnvSection(info);
  }

  showUserInfo(jsonMode = false) {
    const info = this.collectSystemInfo();
    if (jsonMode) { console.log(JSON.stringify(this.extractSection(info, 'user'), null, 2)); return; }
    this.printHeader('USER DETAILS');
    this.printUserSection(info);
  }

  showAllEnvInfo(jsonMode = false) {
    const allEnv = this.getAllEnvironmentVariablesRedacted();
    if (jsonMode) { console.log(JSON.stringify(allEnv, null, 2)); return; }

    this.printHeader('ALL ENV VARS (sensitive values masked)');
    console.log('🔐 ALL ENVIRONMENT VARIABLES:');
    console.log('   🔒 Note: sensitive-looking values are masked.\n');
    const keys = Object.keys(allEnv);
    if (keys.length === 0) {
      console.log('   • (none found)');
    } else {
      keys.forEach(key => {
        const displayValue = this.safeDisplay(allEnv[key]);
        const truncated = displayValue.length > 90 ? displayValue.substring(0, 87) + '...' : displayValue;
        console.log(`   • ${key}: ${truncated}`);
      });
    }
    console.log('');
  }

  // ==================== NETWORK INFORMATION ====================

  getNetworkInfo() {
    try {
      const interfaces = os.networkInterfaces() || {};
      const result = [];
      Object.keys(interfaces).forEach(name => {
        const addrs = interfaces[name] || [];
        const ipv4 = addrs.filter(a => a.family === 'IPv4').map(a => a.address);
        const ipv6 = addrs.filter(a => a.family === 'IPv6').map(a => a.address);
        const macEntry = addrs.find(a => a.mac && a.mac !== '00:00:00:00:00:00');
        const mac = macEntry ? macEntry.mac : (addrs[0] ? addrs[0].mac : '00:00:00:00:00:00');
        const internal = addrs.length > 0 ? !!addrs[0].internal : false;
        result.push({
          interfaceName: name,
          ipv4: ipv4.length > 0 ? ipv4 : ['Not Assigned'],
          ipv6: ipv6.length > 0 ? ipv6 : ['Not Assigned'],
          mac,
          scope: internal ? 'Internal' : 'External'
        });
      });
      return result;
    } catch (error) {
      console.log(`⚠️  Could not read network interfaces: ${error.message}`);
      return [];
    }
  }

  showNetworkInfo(jsonMode = false) {
    const interfaces = this.getNetworkInfo();
    if (jsonMode) { console.log(JSON.stringify(interfaces, null, 2)); return; }

    this.printHeader('NETWORK INTERFACES');
    if (interfaces.length === 0) {
      console.log('   • No network interfaces found.\n');
      return;
    }
    interfaces.forEach(iface => {
      console.log(`🌐 ${iface.interfaceName} (${iface.scope})`);
      console.log(`   • IPv4: ${iface.ipv4.join(', ')}`);
      console.log(`   • IPv6: ${iface.ipv6.join(', ')}`);
      console.log(`   • MAC: ${iface.mac}`);
      console.log('');
    });
  }

  // ==================== PROCESS INFORMATION ====================

  safeCwd() {
    try { return process.cwd(); } catch { return 'Not Available'; }
  }

  getProcessInfo() {
    try {
      const mem = process.memoryUsage();
      return {
        pid: process.pid,
        ppid: typeof process.ppid === 'number' ? process.ppid : 'N/A',
        cwd: this.safeCwd(),
        execPath: process.execPath || 'Unknown',
        nodeVersion: process.version || 'Unknown',
        memoryUsage: {
          rss: this.formatBytes(mem.rss),
          heapTotal: this.formatBytes(mem.heapTotal),
          heapUsed: this.formatBytes(mem.heapUsed),
          external: this.formatBytes(mem.external)
        },
        uptime: this.formatUptime(process.uptime()),
        platform: process.platform || 'unknown',
        architecture: process.arch || 'unknown'
      };
    } catch (error) {
      console.log(`⚠️  Could not read process info: ${error.message}`);
      return null;
    }
  }

  showProcessInfo(jsonMode = false) {
    const info = this.getProcessInfo();
    if (!info) { console.log('❌ Could not collect process information.'); return false; }
    if (jsonMode) { console.log(JSON.stringify(info, null, 2)); return true; }

    this.printHeader('PROCESS INFORMATION');
    console.log(`   • PID: ${info.pid}`);
    console.log(`   • PPID: ${info.ppid}`);
    console.log(`   • CWD: ${info.cwd}`);
    console.log(`   • Executable Path: ${info.execPath}`);
    console.log(`   • Node.js Version: ${info.nodeVersion}`);
    console.log(`   • Memory (RSS): ${info.memoryUsage.rss}`);
    console.log(`   • Memory (Heap Used / Total): ${info.memoryUsage.heapUsed} / ${info.memoryUsage.heapTotal}`);
    console.log(`   • Process Uptime: ${info.uptime}`);
    console.log(`   • Platform: ${info.platform}`);
    console.log(`   • Architecture: ${info.architecture}`);
    console.log('');
    return true;
  }

  // ==================== HEALTH ANALYZER ====================

  static get MEMORY_WARNING_THRESHOLD_PERCENT() { return 75; }
  static get MEMORY_CRITICAL_THRESHOLD_PERCENT() { return 90; }
  static get CPU_LOAD_WARNING_RATIO() { return 0.7; }
  static get CPU_LOAD_CRITICAL_RATIO() { return 1.0; }
  static get UPTIME_RESTART_THRESHOLD_DAYS() { return 7; }

  getCpuLoadStatus() {
    try {
      if (process.platform === 'win32') {
        return { status: 'Not Available', loadPerCore: null };
      }
      const load = os.loadavg();
      if (!load || load.length === 0) {
        return { status: 'Not Available', loadPerCore: null };
      }
      const cores = this.safeGetCpuCores();
      const loadPerCore = load[0] / cores;
      let status = 'Normal';
      if (loadPerCore >= SystemInfoCollector.CPU_LOAD_CRITICAL_RATIO) status = 'High';
      else if (loadPerCore >= SystemInfoCollector.CPU_LOAD_WARNING_RATIO) status = 'Elevated';
      return { status, loadPerCore: Number(loadPerCore.toFixed(2)) };
    } catch {
      return { status: 'Not Available', loadPerCore: null };
    }
  }

  buildHealthSummary(info) {
    const memPercent = parseFloat(info.memoryUsagePercent);
    const memKnown = !isNaN(memPercent);

    let memoryStatus = 'Unknown';
    if (memKnown) {
      if (memPercent >= SystemInfoCollector.MEMORY_CRITICAL_THRESHOLD_PERCENT) memoryStatus = 'Critical';
      else if (memPercent >= SystemInfoCollector.MEMORY_WARNING_THRESHOLD_PERCENT) memoryStatus = 'Warning';
      else memoryStatus = 'Healthy';
    }

    const cpu = this.getCpuLoadStatus();
    const uptimeDays = Math.floor((this.safeGetUptime() || 0) / 86400);

    let systemHealth = 'GOOD';
    if (memoryStatus === 'Critical' || cpu.status === 'High') systemHealth = 'POOR';
    else if (memoryStatus === 'Warning' || cpu.status === 'Elevated') systemHealth = 'FAIR';

    const recommendations = [];
    if (memoryStatus === 'Warning') recommendations.push('Close unused applications to free up memory.');
    if (memoryStatus === 'Critical') recommendations.push('Memory usage is critical — close memory-heavy applications immediately.');
    if (cpu.status === 'Elevated') recommendations.push('CPU load is elevated — check for runaway or background processes.');
    if (cpu.status === 'High') recommendations.push('CPU load is high — investigate and close CPU-intensive processes.');
    if (uptimeDays >= SystemInfoCollector.UPTIME_RESTART_THRESHOLD_DAYS) {
      recommendations.push(`System uptime is ${uptimeDays} days — consider restarting to apply pending updates.`);
    }
    if (recommendations.length === 0) {
      recommendations.push('No immediate action needed — system looks healthy.');
    }

    return {
      hostname: info.hostname,
      platformSummary: `${info.operatingSystem} (${info.platform}/${info.architecture})`,
      cpuCores: info.cpuCores,
      memoryUsagePercent: info.memoryUsagePercent,
      memoryStatus,
      cpuStatus: cpu.status,
      cpuLoadPerCore: cpu.loadPerCore,
      systemHealth,
      nodeVersion: info.nodeVersion,
      uptime: info.uptime,
      recommendations,
      generatedAt: info.timestamp
    };
  }

  showHealthSummary(jsonMode = false) {
    const info = this.collectSystemInfo();
    const summary = this.buildHealthSummary(info);
    if (jsonMode) { console.log(JSON.stringify(summary, null, 2)); return; }

    const healthIcon = { GOOD: '🟢', FAIR: '🟡', POOR: '🔴' }[summary.systemHealth] || '⚪';
    const memIcon = { Healthy: '🟢', Warning: '🟡', Critical: '🔴', Unknown: '⚪' }[summary.memoryStatus] || '⚪';
    const cpuIcon = { Normal: '🟢', Elevated: '🟡', High: '🔴', 'Not Available': '⚪', Unknown: '⚪' }[summary.cpuStatus] || '⚪';

    this.printHeader('SYSTEM HEALTH SUMMARY');
    console.log(`   System Health: ${healthIcon} ${summary.systemHealth}`);
    console.log(`   Memory Status: ${memIcon} ${summary.memoryStatus.toUpperCase()} (${summary.memoryUsagePercent})`);
    console.log(`   CPU Status: ${cpuIcon} ${summary.cpuStatus.toUpperCase()}${summary.cpuLoadPerCore !== null ? ` (load/core: ${summary.cpuLoadPerCore})` : ''}`);
    console.log(`   Uptime: ${summary.uptime}`);
    console.log('');
    console.log('   Recommendations:');
    summary.recommendations.forEach(r => console.log(`   - ${r}`));
    console.log('');
  }

  // ==================== AUDIT LOG ====================

  logAction(action, filename = '') {
    try {
      const timestamp = new Date().toISOString();
      const line = `[${timestamp}] ${action}${filename ? ' ' + filename : ''}\n`;
      fs.appendFileSync(this.logFilePath, line, 'utf-8');
    } catch (error) {
      console.log(`⚠️  Could not write to audit log: ${error.message}`);
    }
  }

  // NEWFIX-C: split on /\r?\n/ to handle CRLF files from Windows
  readLines(filepath) {
    if (!fs.existsSync(filepath)) return [];
    const content = fs.readFileSync(filepath, 'utf-8');
    return content.split(/\r?\n/).filter(line => line.trim().length > 0);
  }

  showLogs(jsonMode = false) {
    try {
      const lines = this.readLines(this.logFilePath);
      const recent = lines.slice(-this.maxLogEntriesShown);

      if (jsonMode) { console.log(JSON.stringify(recent, null, 2)); return; }

      if (lines.length === 0) {
        console.log('📋 No log entries yet — create/update/delete/rename/copy a file to generate one.');
        return;
      }

      this.printHeader(`AUDIT LOG (last ${recent.length})`);
      recent.forEach(line => console.log(`   ${line}`));
      console.log('');
    } catch (error) {
      console.log(`❌ Error reading audit log: ${error.message}`);
    }
  }

  // ==================== COMMAND HISTORY ====================

  logCommand(commandLine) {
    try {
      const timestamp = new Date().toISOString();
      fs.appendFileSync(this.historyFilePath, `[${timestamp}] ${commandLine}\n`, 'utf-8');
    } catch {
      // Non-critical — history is a convenience feature, never block the run
    }
  }

  showHistory(jsonMode = false) {
    try {
      const lines = this.readLines(this.historyFilePath);
      // FIX-13: use historyDisplayLimit (renamed from maxHistoryEntries)
      const recent = lines.slice(-this.historyDisplayLimit).reverse();

      if (jsonMode) { console.log(JSON.stringify(recent, null, 2)); return; }

      if (lines.length === 0) {
        console.log('🕘 No command history yet.');
        return;
      }

      this.printHeader(`HISTORY (last ${recent.length}, most recent first)`);
      recent.forEach((line, idx) => console.log(`   ${idx + 1}. ${line}`));
      console.log('');
    } catch (error) {
      console.log(`❌ Error reading command history: ${error.message}`);
    }
  }

  // ==================== FILENAME VALIDATION HELPERS ====================

  // FIX-7: shared helper for output filenames (saveToJSON / saveReportToFile)
  // avoids duplicating VALID_FILENAME_PATTERN + WINDOWS_RESERVED checks inline
  _validateOutputFilename(filename) {
    if (!VALID_FILENAME_PATTERN.test(filename) ||
        filename.includes('..') || filename.includes('/') || filename.includes('\\') ||
        WINDOWS_RESERVED.test(filename)) {
      console.log('❌ Invalid filename');
      return false;
    }
    return true;
  }

  // ==================== CRUD OPERATIONS ====================

  validateFileName(filename) {
    if (!filename || typeof filename !== 'string' || filename.trim() === '') {
      console.log('❌ Invalid filename: must be a non-empty string');
      return false;
    }
    if (filename.length > 255) {
      console.log('❌ Filename too long: must be less than 255 characters');
      return false;
    }
    if (!VALID_FILENAME_PATTERN.test(filename)) {
      console.log('❌ Invalid filename: only alphanumeric, dots, hyphens, underscores allowed; must start and end with an alphanumeric character (no leading/trailing dots)');
      return false;
    }
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      console.log('❌ Invalid filename: cannot contain path separators or ".."');
      return false;
    }
    if (WINDOWS_RESERVED.test(filename)) {
      console.log('❌ Invalid filename: Windows reserved device name');
      return false;
    }
    if (SYSTEM_FILES.has(filename)) {
      console.log(`❌ "${filename}" is a protected system file and cannot be accessed via this command`);
      return false;
    }
    return true;
  }

  validateFileContent(content) {
    if (content === null || content === undefined) {
      return '';
    }
    if (typeof content !== 'string') {
      content = String(content);
    }
    const byteSize = Buffer.byteLength(content, 'utf-8');
    if (byteSize > this.maxFileSize) {
      console.log(`❌ Content too large: ${this.formatBytes(byteSize)} (maximum size is ${this.formatBytes(this.maxFileSize)})`);
      return null;
    }
    return content;
  }

  createFile(filename, content = '') {
    try {
      if (!this.validateFileName(filename)) return false;

      const validatedContent = this.validateFileContent(content);
      if (validatedContent === null) return false;

      const filepath = path.join(this.filesDir, filename);

      if (fs.existsSync(filepath)) {
        console.log(`⚠️  File already exists: ${filename}`);
        return false;
      }

      if (!fs.existsSync(this.filesDir)) {
        try {
          fs.mkdirSync(this.filesDir, { recursive: true });
        } catch (error) {
          console.log(`❌ Cannot create directory: ${error.message}`);
          return false;
        }
      }

      fs.writeFileSync(filepath, validatedContent, 'utf-8');

      if (!fs.existsSync(filepath)) {
        console.log(`❌ File creation failed (file not found after write): ${filename}`);
        return false;
      }

      console.log(`✅ File created successfully: ${filename} (${this.formatBytes(Buffer.byteLength(validatedContent, 'utf-8'))})`);
      this.logAction('CREATE', filename);
      return true;
    } catch (error) {
      console.log(`❌ Error creating file: ${error.message}`);
      return false;
    }
  }

  readFile(filename) {
    try {
      if (!this.validateFileName(filename)) return null;

      const filepath = path.join(this.filesDir, filename);

      if (!fs.existsSync(filepath)) {
        console.log(`❌ File not found: ${filename}`);
        return null;
      }

      const stats = fs.statSync(filepath);
      if (!stats.isFile()) {
        console.log(`❌ Path is not a file: ${filename}`);
        return null;
      }

      if (stats.size > this.maxFileSize) {
        console.log(`❌ File too large to read: ${this.formatBytes(stats.size)} (max: ${this.formatBytes(this.maxFileSize)})`);
        return null;
      }

      const content = fs.readFileSync(filepath, 'utf-8');
      console.log(`✅ File read successfully: ${filename} (${this.formatBytes(stats.size)})`);
      console.log('─'.repeat(50));
      console.log(content);
      console.log('─'.repeat(50));
      return content;
    } catch (error) {
      console.log(`❌ Error reading file: ${error.message}`);
      return null;
    }
  }

  updateFile(filename, content) {
    try {
      if (!this.validateFileName(filename)) return false;

      const validatedContent = this.validateFileContent(content);
      if (validatedContent === null) return false;

      const filepath = path.join(this.filesDir, filename);

      if (!fs.existsSync(filepath)) {
        console.log(`❌ File not found: ${filename}`);
        return false;
      }

      const stats = fs.statSync(filepath);
      if (!stats.isFile()) {
        console.log(`❌ Path is not a file: ${filename}`);
        return false;
      }

      // FIX-3: store backups in .backups/ subdirectory so they don't appear in listFiles()
      this.ensureBackupsDirectory();
      const backupPath = path.join(this.backupsDir, `${filename}.bak.${Date.now()}`);
      try {
        fs.copyFileSync(filepath, backupPath);
        console.log(`📦 Backup created: .backups/${path.basename(backupPath)}`);
      } catch {
        // Backup failure is not critical, continue
      }

      fs.writeFileSync(filepath, validatedContent, 'utf-8');
      console.log(`✅ File updated successfully: ${filename} (${this.formatBytes(Buffer.byteLength(validatedContent, 'utf-8'))})`);
      this.logAction('UPDATE', filename);
      return true;
    } catch (error) {
      console.log(`❌ Error updating file: ${error.message}`);
      return false;
    }
  }

  deleteFile(filename) {
    try {
      if (!this.validateFileName(filename)) return false;

      const filepath = path.join(this.filesDir, filename);

      if (!fs.existsSync(filepath)) {
        console.log(`❌ File not found: ${filename}`);
        return false;
      }

      const stats = fs.statSync(filepath);
      if (!stats.isFile()) {
        console.log(`❌ Path is not a file: ${filename}`);
        return false;
      }

      fs.unlinkSync(filepath);

      if (fs.existsSync(filepath)) {
        console.log(`❌ File deletion failed (file still exists): ${filename}`);
        return false;
      }

      console.log(`✅ File deleted successfully: ${filename}`);
      this.logAction('DELETE', filename);
      return true;
    } catch (error) {
      console.log(`❌ Error deleting file: ${error.message}`);
      return false;
    }
  }

  renameFile(oldName, newName) {
    try {
      if (!this.validateFileName(oldName) || !this.validateFileName(newName)) return false;

      const oldPath = path.join(this.filesDir, oldName);
      const newPath = path.join(this.filesDir, newName);

      if (!fs.existsSync(oldPath)) {
        console.log(`❌ File not found: ${oldName}`);
        return false;
      }

      const stats = fs.statSync(oldPath);
      if (!stats.isFile()) {
        console.log(`❌ Path is not a file: ${oldName}`);
        return false;
      }

      if (fs.existsSync(newPath)) {
        console.log(`⚠️  Cannot rename: a file named "${newName}" already exists`);
        return false;
      }

      fs.renameSync(oldPath, newPath);

      if (fs.existsSync(oldPath) || !fs.existsSync(newPath)) {
        console.log(`❌ Rename failed (unexpected state after operation): ${oldName} -> ${newName}`);
        return false;
      }

      console.log(`✅ File renamed successfully: ${oldName} -> ${newName}`);
      this.logAction('RENAME', `${oldName} -> ${newName}`);
      return true;
    } catch (error) {
      console.log(`❌ Error renaming file: ${error.message}`);
      return false;
    }
  }

  // NEWFIX-D: EEXIST from COPYFILE_EXCL shows friendly message
  copyFile(source, destination) {
    try {
      if (!this.validateFileName(source) || !this.validateFileName(destination)) return false;

      const sourcePath = path.join(this.filesDir, source);
      const destPath = path.join(this.filesDir, destination);

      if (!fs.existsSync(sourcePath)) {
        console.log(`❌ File not found: ${source}`);
        return false;
      }

      const stats = fs.statSync(sourcePath);
      if (!stats.isFile()) {
        console.log(`❌ Path is not a file: ${source}`);
        return false;
      }

      if (fs.existsSync(destPath)) {
        console.log(`⚠️  Cannot copy: a file named "${destination}" already exists`);
        return false;
      }

      fs.copyFileSync(sourcePath, destPath, fs.constants.COPYFILE_EXCL);

      if (!fs.existsSync(destPath)) {
        console.log(`❌ Copy failed (destination not found after operation): ${destination}`);
        return false;
      }

      console.log(`✅ File copied successfully: ${source} -> ${destination}`);
      this.logAction('COPY', `${source} -> ${destination}`);
      return true;
    } catch (error) {
      if (error.code === 'EEXIST') {
        console.log(`⚠️  Cannot copy: a file named "${destination}" already exists`);
      } else {
        console.log(`❌ Error copying file: ${error.message}`);
      }
      return false;
    }
  }

  searchFiles(keyword) {
    try {
      if (!keyword || typeof keyword !== 'string' || keyword.trim().length === 0) {
        console.log('❌ Search keyword cannot be empty');
        return [];
      }
      if (!fs.existsSync(this.filesDir)) {
        console.log('📁 No files directory found');
        return [];
      }

      const lowerKeyword = keyword.toLowerCase();
      const files = fs.readdirSync(this.filesDir);
      return files.filter(file => {
        if (SYSTEM_FILES.has(file)) return false;
        try {
          const filepath = path.join(this.filesDir, file);
          return fs.statSync(filepath).isFile() && file.toLowerCase().includes(lowerKeyword);
        } catch {
          return false;
        }
      });
    } catch (error) {
      console.log(`❌ Error searching files: ${error.message}`);
      return [];
    }
  }

  showSearchResults(keyword, jsonMode = false) {
    const matches = this.searchFiles(keyword);

    if (jsonMode) {
      console.log(JSON.stringify({ keyword, matches }, null, 2));
      return matches.length > 0;
    }

    if (matches.length === 0) {
      console.log(`🔍 No files found matching "${keyword}"`);
      return false;
    }

    console.log(`\n🔍 Files matching "${keyword}" (${matches.length}):`);
    matches.forEach((file, idx) => console.log(`   ${idx + 1}. ${file}`));
    console.log('');
    return true;
  }

  listFiles() {
    try {
      if (!fs.existsSync(this.filesDir)) {
        console.log('📁 No files directory found');
        return [];
      }

      const files = fs.readdirSync(this.filesDir);
      const fileList = files.filter(file => {
        if (SYSTEM_FILES.has(file)) return false;
        try {
          return fs.statSync(path.join(this.filesDir, file)).isFile();
        } catch {
          return false;
        }
      });

      if (fileList.length === 0) {
        console.log('📁 No files found in directory');
        return [];
      }

      console.log(`\n📁 Files in directory (${fileList.length}):`);
      let totalSize = 0;
      fileList.forEach((file, index) => {
        try {
          const filepath = path.join(this.filesDir, file);
          const stats = fs.statSync(filepath);
          totalSize += stats.size;
          const created = new Date(stats.birthtime).toLocaleString();
          console.log(`   ${index + 1}. ${file} (${this.formatBytes(stats.size)}) - Created: ${created}`);
        } catch (error) {
          console.log(`   ${index + 1}. ${file} (Error reading stats)`);
        }
      });
      console.log(`   Total Size: ${this.formatBytes(totalSize)}`);
      console.log('');
      return fileList;
    } catch (error) {
      console.log(`❌ Error listing files: ${error.message}`);
      return [];
    }
  }

  getFileNamesQuiet() {
    try {
      if (!fs.existsSync(this.filesDir)) return [];
      return fs.readdirSync(this.filesDir).filter(file => {
        if (SYSTEM_FILES.has(file)) return false;
        try {
          return fs.statSync(path.join(this.filesDir, file)).isFile();
        } catch {
          return false;
        }
      });
    } catch {
      return [];
    }
  }

  // FIX-4 + FIX-7: use _validateOutputFilename() helper; single SYSTEM_FILES
  // source of truth with intentional exception for systemInfo.json default
  saveToJSON(filename = 'systemInfo.json') {
    try {
      if (!this._validateOutputFilename(filename)) return false;

      // Block all protected names except systemInfo.json (the intended default output)
      const blockedForSaveJson = new Set([...SYSTEM_FILES].filter(n => n !== 'systemInfo.json'));
      if (blockedForSaveJson.has(filename)) {
        console.log(`❌ "${filename}" is a protected system file and cannot be overwritten via --save-json`);
        return false;
      }

      const info = this.collectSystemInfo();
      const filepath = path.join(this.filesDir, filename);

      if (!fs.existsSync(this.filesDir)) {
        try {
          fs.mkdirSync(this.filesDir, { recursive: true });
        } catch (error) {
          console.log(`❌ Cannot create directory for JSON: ${error.message}`);
          return false;
        }
      }

      const jsonString = JSON.stringify(info, null, 2);

      try {
        JSON.parse(jsonString);
      } catch (error) {
        console.log(`❌ Generated JSON is invalid: ${error.message}`);
        return false;
      }

      fs.writeFileSync(filepath, jsonString, 'utf-8');

      if (!fs.existsSync(filepath)) {
        console.log('❌ JSON file creation failed');
        return false;
      }

      const fileSize = fs.statSync(filepath).size;
      console.log(`✅ System info saved to: ${filename} (${this.formatBytes(fileSize)})`);
      return true;
    } catch (error) {
      console.log(`❌ Error saving to JSON: ${error.message}`);
      return false;
    }
  }

  // NEWFIX-F: isFile() guard added
  getFileStats(filename) {
    try {
      if (!this.validateFileName(filename)) return null;

      const filepath = path.join(this.filesDir, filename);

      if (!fs.existsSync(filepath)) {
        console.log(`❌ File not found: ${filename}`);
        return null;
      }

      const stats = fs.statSync(filepath);
      if (!stats.isFile()) {
        console.log(`❌ Path is not a file: ${filename}`);
        return null;
      }

      return {
        filename: filename,
        size: this.formatBytes(stats.size),
        sizeBytes: stats.size,
        created: new Date(stats.birthtime).toISOString(),
        modified: new Date(stats.mtime).toISOString(),
        accessed: new Date(stats.atime).toISOString(),
        isReadable: this.isFileReadable(filepath),
        isWritable: this.isFileWritable(filepath)
      };
    } catch (error) {
      console.log(`❌ Error getting file stats: ${error.message}`);
      return null;
    }
  }

  // FIX-9: added SHA-512; labelled MD5 as non-cryptographic
  getFileHashes(filename) {
    try {
      if (!this.validateFileName(filename)) return null;

      const filepath = path.join(this.filesDir, filename);

      if (!fs.existsSync(filepath)) {
        console.log(`❌ File not found: ${filename}`);
        return null;
      }

      const stats = fs.statSync(filepath);
      if (!stats.isFile()) {
        console.log(`❌ Path is not a file: ${filename}`);
        return null;
      }

      if (stats.size > this.maxFileSize) {
        console.log(`❌ File too large to hash: ${this.formatBytes(stats.size)} (max: ${this.formatBytes(this.maxFileSize)})`);
        return null;
      }

      const buffer = fs.readFileSync(filepath);
      return {
        filename,
        sizeBytes: stats.size,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
        sha512: crypto.createHash('sha512').update(buffer).digest('hex'),
        md5_legacy: crypto.createHash('md5').update(buffer).digest('hex')  // non-cryptographic, legacy only
      };
    } catch (error) {
      console.log(`❌ Error hashing file: ${error.message}`);
      return null;
    }
  }

  showFileHashes(filename, jsonMode = false) {
    const result = this.getFileHashes(filename);
    if (!result) return false;

    if (jsonMode) { console.log(JSON.stringify(result, null, 2)); return true; }

    console.log(`\n🔑 Hashes for ${result.filename} (${this.formatBytes(result.sizeBytes)}):`);
    console.log(`   • SHA-256: ${result.sha256}`);
    console.log(`   • SHA-512: ${result.sha512}`);
    console.log(`   • MD5 (non-cryptographic, legacy only): ${result.md5_legacy}`);
    console.log('');
    return true;
  }

  // ==================== COMPLETE SYSTEM REPORT ====================

  buildCompleteReport() {
    const systemInfo = this.collectSystemInfo();
    const processInfo = this.getProcessInfo();
    const networkInfo = this.getNetworkInfo();
    const fileStatistics = this.getFileNamesQuiet()
      .map(name => this.getFileStats(name))
      .filter(Boolean);

    return {
      generatedAt: new Date().toISOString(),
      systemInformation: systemInfo,
      environmentVariables: systemInfo.environmentVariables,
      processInformation: processInfo,
      networkInformation: networkInfo,
      fileStatistics
    };
  }

  // FIX-7: use shared _validateOutputFilename() helper
  saveReportToFile(reportData, filename = 'systemReport.json') {
    try {
      if (!this._validateOutputFilename(filename)) return false;

      const filepath = path.join(this.filesDir, filename);

      if (!fs.existsSync(this.filesDir)) {
        try {
          fs.mkdirSync(this.filesDir, { recursive: true });
        } catch (error) {
          console.log(`❌ Cannot create directory for report: ${error.message}`);
          return false;
        }
      }

      const jsonString = JSON.stringify(reportData, null, 2);

      try {
        JSON.parse(jsonString);
      } catch (error) {
        console.log(`❌ Generated report JSON is invalid: ${error.message}`);
        return false;
      }

      fs.writeFileSync(filepath, jsonString, 'utf-8');

      if (!fs.existsSync(filepath)) {
        console.log('❌ Report file creation failed');
        return false;
      }

      return true;
    } catch (error) {
      console.log(`❌ Error saving report: ${error.message}`);
      return false;
    }
  }

  showReport(jsonMode = false) {
    const report = this.buildCompleteReport();
    const filename = 'systemReport.json';
    const saved = this.saveReportToFile(report, filename);

    if (jsonMode) { console.log(JSON.stringify(report, null, 2)); return saved; }

    this.printHeader('COMPLETE SYSTEM REPORT');
    console.log(`   • Hostname: ${this.safeDisplay(report.systemInformation.hostname)}`);
    console.log(`   • Platform: ${this.safeDisplay(report.systemInformation.operatingSystem)} (${this.safeDisplay(report.systemInformation.platform)})`);
    console.log(`   • Process PID: ${report.processInformation ? report.processInformation.pid : 'N/A'}`);
    console.log(`   • Network Interfaces: ${report.networkInformation.length}`);
    console.log(`   • Files Tracked: ${report.fileStatistics.length}`);
    console.log(`   • Generated At: ${this.safeDisplay(report.generatedAt)}`);
    console.log('');

    if (saved) {
      const filepath = path.join(this.filesDir, filename);
      const size = fs.existsSync(filepath) ? this.formatBytes(fs.statSync(filepath).size) : 'Unknown';
      console.log(`✅ Full report saved to: ${filename} (${size})`);
    } else {
      console.log('⚠️  Report generated but could not be saved to disk — see error above.');
    }
    console.log('');
    return saved;
  }

  isFileReadable(filepath) {
    try { fs.accessSync(filepath, fs.constants.R_OK); return true; } catch { return false; }
  }

  isFileWritable(filepath) {
    try { fs.accessSync(filepath, fs.constants.W_OK); return true; } catch { return false; }
  }
}

// ==================== CLI LAYER ====================

// FIX-14: generate HELP_TEXT dynamically so version line stays centered
function buildHelpText(version) {
  const width = SystemInfoCollector.BOX_INNER_WIDTH;
  const centerLine = (text) => {
    const str = String(text);
    const totalPad = Math.max(0, width - str.length);
    const left = Math.floor(totalPad / 2);
    const right = totalPad - left;
    return '║' + ' '.repeat(left) + str + ' '.repeat(right) + '║';
  };
  return `
╔${'═'.repeat(width)}╗
${centerLine('SYSTEM INFO COLLECTOR & FILE MANAGER — CLI HELP')}
${centerLine('v' + version)}
╚${'═'.repeat(width)}╝

USAGE:
  node code.js <command> [arguments] [--json] [--verbose|-v]

SYSTEM INFORMATION COMMANDS:
  --all              Full system information report
  --os               OS, platform, architecture, hostname, home dir
  --cpu              CPU model, core count, clock speed (per-core w/ --verbose)
  --memory           Total / used / free memory and usage percent
  --node             Node.js, NPM, and Python versions
  --env              Safe, allowlisted set of environment variables
  --env-all          EVERY environment variable, secret-looking values masked
  --user             Username, UID, GID, and shell
  --network          Network interfaces (IPv4, IPv6, MAC, internal/external)
  --process          PID, PPID, CWD, memory usage, uptime, and more
  --summary          Health analyzer: verdict + memory/CPU status + tips
  --save-json [file] Save the full system report to JSON (default systemInfo.json)

MODIFIERS:
  --json             Add to any command above for raw JSON output
  --verbose, -v      Enable full PATH, per-core CPU detail, debug error messages

FILE (CRUD) COMMANDS — all scoped to ./collected_files:
  create <filename> [content]    Create a new file with optional content
  read <filename>                 Print a file's contents
  update <filename> <content>     Overwrite a file (writes a timestamped .bak backup)
  update <filename> --empty       Explicitly clear a file's content
  delete <filename>               Delete a file
  list                             List all files with size and creation date
  stats <filename>                 Size, timestamps, and permissions
  rename <old> <new>               Rename a file (refuses to overwrite)
  copy <source> <dest>             Copy a file (refuses to overwrite)
  search <keyword>                 Case-insensitive filename search
  hash <filename>                  SHA-256, SHA-512 + MD5 (legacy) digest of a file

ACTIVITY & REPORTING:
  logs               Show recent audit log entries
  history            Show the last 20 commands run through this CLI
  report             Build + save a full report (system, process, network, files)

OTHER:
  --help, -h         Show this help message
  --version          Show the CLI's version number

NOTES:
  • Filenames must start and end with a letter/number, cannot contain
    path separators or "..", and cannot be a Windows reserved device
    name (CON, NUL, COM1, etc).
  • logs.txt, history.txt, systemInfo.json, and systemReport.json are
    protected system files — invisible to list/search and untouchable
    via create/read/update/delete/rename/copy/stats/hash.
  • update <filename> without content requires --empty flag to prevent
    accidental file erasure.
  • --env-all reads your real environment. Secret-looking values are
    masked automatically, but review output before sharing it.
  • Backup files are stored in collected_files/.backups/ and are not
    shown in list or search results.
`;
}

function printHelp() {
  console.log(buildHelpText(VERSION));
}

function dispatchCommand(collector, command, args, jsonMode) {
  switch (command) {
    case '--all':
      collector.displaySystemInfo(collector.collectSystemInfo(), jsonMode);
      return true;

    case '--os':
      collector.showOSInfo(jsonMode);
      return true;

    case '--cpu':
      collector.showCPUInfo(jsonMode);
      return true;

    case '--memory':
      collector.showMemoryInfo(jsonMode);
      return true;

    case '--node':
      collector.showNodeInfo(jsonMode);
      return true;

    case '--env':
      collector.showEnvInfo(jsonMode);
      return true;

    case '--env-all':
      collector.showAllEnvInfo(jsonMode);
      return true;

    case '--user':
      collector.showUserInfo(jsonMode);
      return true;

    case '--network':
      collector.showNetworkInfo(jsonMode);
      return true;

    case '--process':
      return collector.showProcessInfo(jsonMode);

    case '--summary':
      collector.showHealthSummary(jsonMode);
      return true;

    case '--save-json': {
      const filename = args[0] || 'systemInfo.json';
      return collector.saveToJSON(filename);
    }

    case 'create': {
      const filename = args[0];
      const content = args.slice(1).join(' ');
      if (!filename) { console.log('❌ Usage: node code.js create <filename> [content]'); return false; }
      return collector.createFile(filename, content);
    }

    case 'read': {
      const filename = args[0];
      if (!filename) { console.log('❌ Usage: node code.js read <filename>'); return false; }
      return collector.readFile(filename) !== null;
    }

    // FIX-10: require --empty flag to explicitly clear a file instead of silent erasure
    case 'update': {
      const filename = args[0];
      if (!filename) { console.log('❌ Usage: node code.js update <filename> <content>'); return false; }
      const isEmptyFlag = args[1] === '--empty';
      const content = isEmptyFlag ? '' : args.slice(1).join(' ');
      if (!isEmptyFlag && !content) {
        console.log('❌ No content provided. To intentionally clear a file, use: node code.js update <filename> --empty');
        return false;
      }
      return collector.updateFile(filename, content);
    }

    case 'delete': {
      const filename = args[0];
      if (!filename) { console.log('❌ Usage: node code.js delete <filename>'); return false; }
      return collector.deleteFile(filename);
    }

    case 'list':
      collector.listFiles();
      return true;

    case 'stats': {
      const filename = args[0];
      if (!filename) { console.log('❌ Usage: node code.js stats <filename>'); return false; }
      const fileStats = collector.getFileStats(filename);
      if (fileStats) {
        if (jsonMode) {
          console.log(JSON.stringify(fileStats, null, 2));
        } else {
          console.log(`\n📊 File Stats for ${fileStats.filename}:`);
          console.log(`   • Size: ${fileStats.size}`);
          console.log(`   • Size (bytes): ${fileStats.sizeBytes}`);
          console.log(`   • Created: ${fileStats.created}`);
          console.log(`   • Modified: ${fileStats.modified}`);
          console.log(`   • Accessed: ${fileStats.accessed}`);
          console.log(`   • Readable: ${fileStats.isReadable ? '✅ Yes' : '❌ No'}`);
          console.log(`   • Writable: ${fileStats.isWritable ? '✅ Yes' : '❌ No'}\n`);
        }
      }
      return fileStats !== null;
    }

    case 'rename': {
      const oldName = args[0];
      const newName = args[1];
      if (!oldName || !newName) { console.log('❌ Usage: node code.js rename <oldname> <newname>'); return false; }
      return collector.renameFile(oldName, newName);
    }

    case 'copy': {
      const source = args[0];
      const destination = args[1];
      if (!source || !destination) { console.log('❌ Usage: node code.js copy <source> <destination>'); return false; }
      return collector.copyFile(source, destination);
    }

    case 'search': {
      const keyword = args.join(' ');
      if (!keyword) { console.log('❌ Usage: node code.js search <keyword>'); return false; }
      return collector.showSearchResults(keyword, jsonMode);
    }

    case 'hash': {
      const filename = args[0];
      if (!filename) { console.log('❌ Usage: node code.js hash <filename>'); return false; }
      return collector.showFileHashes(filename, jsonMode);
    }

    case 'logs':
      collector.showLogs(jsonMode);
      return true;

    case 'history':
      collector.showHistory(jsonMode);
      return true;

    case 'report':
      return collector.showReport(jsonMode);

    case '--help':
    case '-h':
      printHelp();
      return true;

    // NEWFIX-G + note: '--version' handled in main() before this is reached.
    // Falls through to default so edge-cases are caught cleanly.

    default:
      console.log(`❌ Unknown command: "${command}"`);
      console.log('   Run "node code.js --help" to see available commands.\n');
      return false;
  }
}

function main() {
  try {
    const rawArgv = process.argv.slice(2);

    // FIX-6: removed dead MODIFIER_FLAGS Set that was never used
    let jsonMode = false;
    const argv = rawArgv.filter(arg => {
      if (arg === '--json') { jsonMode = true; return false; }
      if (arg === '--verbose' || arg === '-v') { return false; }
      return true;
    });

    const command = argv[0];
    const args = argv.slice(1);

    if (rawArgv.includes('--version')) {
      console.log(`System Info CLI v${VERSION}`);
      process.exit(EXIT_SUCCESS);
    }

    if (!command) {
      printHelp();
      process.exit(EXIT_SUCCESS);
    }

    const collector = new SystemInfoCollector();
    collector.logCommand(`node code.js ${rawArgv.join(' ')}`);
    const success = dispatchCommand(collector, command, args, jsonMode);
    process.exit(success ? EXIT_SUCCESS : EXIT_ERROR);
  } catch (error) {
    console.error('\n❌ Critical Error:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(EXIT_ERROR);
  }
}

process.on('uncaughtException', (error) => {
  console.error('\n❌ Uncaught Exception:', error.message);
  process.exit(EXIT_ERROR);
});

process.on('unhandledRejection', (reason) => {
  console.error('\n❌ Unhandled Rejection:', reason);
  process.exit(EXIT_ERROR);
});

if (require.main === module) {
  main();
}

module.exports = SystemInfoCollector;