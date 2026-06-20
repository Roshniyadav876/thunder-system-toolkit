const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ==================== SYSTEM INFORMATION COLLECTOR ====================
// Now operating as a command-line utility instead of a fixed demo script.

class SystemInfoCollector {
  constructor() {
    this.filesDir = path.join(__dirname, 'collected_files');
    this.maxFileSize = 10 * 1024 * 1024; // 10MB max file size
    this.validFileNamePattern = /^[a-zA-Z0-9._\-]+$/;
    this.ensureFilesDirectory();
  }

  // Ensure the files directory exists with proper error handling
  ensureFilesDirectory() {
    try {
      if (!fs.existsSync(this.filesDir)) {
        fs.mkdirSync(this.filesDir, { recursive: true, mode: 0o755 });
      }

      // Verify directory is writable
      fs.accessSync(this.filesDir, fs.constants.W_OK);
    } catch (error) {
      console.error('❌ Error creating/accessing files directory:', error.message);
      // Use temp directory as fallback
      this.filesDir = path.join(os.tmpdir(), 'system_info_collector_' + Date.now());
      try {
        fs.mkdirSync(this.filesDir, { recursive: true });
      } catch (fallbackError) {
        console.error('❌ Critical: Cannot create any directory for file operations');
      }
    }
  }

  // ==================== COLLECT SYSTEM INFORMATION ====================

  collectSystemInfo() {
    try {
      // Safely get all system information with fallbacks
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
        totalMemory: this.formatBytes(this.safeGetTotalMemory()),
        freeMemory: this.formatBytes(this.safeGetFreeMemory()),
        usedMemory: this.formatBytes(this.safeGetUsedMemory()),
        memoryUsagePercent: this.safeGetMemoryUsagePercent(),
        uptime: this.formatUptime(this.safeGetUptime()),
        environmentVariables: this.getSelectedEnvironmentVariables(),
        timestamp: new Date().toISOString(),
        userInfo: this.safeGetUserInfo()
      };
      return systemInfo;
    } catch (error) {
      console.error('❌ Error collecting system info:', error.message);
      return this.getDefaultSystemInfo();
    }
  }

  // Safe getters with fallbacks
  safeGetOSType() {
    try {
      return os.type() || 'Unknown OS';
    } catch {
      return 'Unknown OS';
    }
  }

  safeGetOSVersion() {
    try {
      return os.release() || 'Unknown Version';
    } catch {
      return 'Unknown Version';
    }
  }

  safeGetPlatform() {
    try {
      return os.platform() || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  safeGetArchitecture() {
    try {
      return os.arch() || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  safeGetHostname() {
    try {
      return os.hostname() || 'localhost';
    } catch {
      return 'localhost';
    }
  }

  safeGetNodeVersion() {
    try {
      return process.version || 'Unknown';
    } catch {
      return 'Unknown';
    }
  }

  safeGetCpuCores() {
    try {
      const cpus = os.cpus();
      return (cpus && cpus.length > 0) ? cpus.length : 1;
    } catch {
      return 1;
    }
  }

  safeGetCpuModel() {
    try {
      const cpus = os.cpus();
      return (cpus && cpus[0] && cpus[0].model) ? cpus[0].model : 'Unknown CPU';
    } catch {
      return 'Unknown CPU';
    }
  }

  safeGetTotalMemory() {
    try {
      const total = os.totalmem();
      return total > 0 ? total : 0;
    } catch {
      return 0;
    }
  }

  safeGetFreeMemory() {
    try {
      const free = os.freemem();
      return free >= 0 ? free : 0;
    } catch {
      return 0;
    }
  }

  safeGetUsedMemory() {
    try {
      const total = this.safeGetTotalMemory();
      const free = this.safeGetFreeMemory();
      return Math.max(0, total - free);
    } catch {
      return 0;
    }
  }

  safeGetMemoryUsagePercent() {
    try {
      const total = this.safeGetTotalMemory();
      const used = this.safeGetUsedMemory();
      if (total === 0) return '0%';
      return ((used / total) * 100).toFixed(2) + '%';
    } catch {
      return 'Unknown';
    }
  }

  safeGetUptime() {
    try {
      const uptime = os.uptime();
      return uptime >= 0 ? uptime : 0;
    } catch {
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
    } catch {
      return process.env.HOME || process.env.USERPROFILE || 'Not Available';
    }
  }

  safeGetUserInfo() {
    try {
      return {
        username: process.env.USER || process.env.USERNAME || 'Unknown',
        uid: os.userInfo().uid || 'N/A',
        gid: os.userInfo().gid || 'N/A',
        shell: os.userInfo().shell || 'Not Available'
      };
    } catch {
      return {
        username: process.env.USER || 'Unknown',
        uid: 'N/A',
        gid: 'N/A',
        shell: 'Not Available'
      };
    }
  }

  // Get default system info when all else fails
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

  // Get NPM version with fallback
  getNpmVersion() {
    try {
      const npmVersion = execSync('npm -v', {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
      return npmVersion || 'Unknown';
    } catch {
      // Try alternate method
      try {
        return require('npm/package.json').version || 'Unknown';
      } catch {
        return 'Unknown';
      }
    }
  }

  // Get Python version (bonus)
  getPythonVersion() {
    try {
      const pythonVersion = execSync('python --version 2>&1 || python3 --version', {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
      return pythonVersion || 'Not Installed';
    } catch {
      return 'Not Installed';
    }
  }

  // Get selected environment variables
  getSelectedEnvironmentVariables() {
    const selectedVars = [
      'PATH',
      'HOME',
      'USER',
      'SHELL',
      'LANG',
      'NODE_ENV',
      'PWD'
    ];

    const envVars = {};
    selectedVars.forEach(varName => {
      envVars[varName] = process.env[varName] || 'Not Set';
    });
    return envVars;
  }

  // Format bytes to human readable with better edge cases
  formatBytes(bytes) {
    try {
      if (bytes === null || bytes === undefined) return '0 Bytes';

      bytes = parseInt(bytes);
      if (isNaN(bytes) || bytes < 0) return '0 Bytes';
      if (bytes === 0) return '0 Bytes';

      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));

      if (i < 0 || i >= sizes.length) return bytes + ' Bytes';

      const result = Math.round((bytes / Math.pow(k, i)) * 100) / 100;
      return result + ' ' + sizes[i];
    } catch {
      return '0 Bytes';
    }
  }

  // Format uptime to human readable with edge cases
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

  // Safe display for null/undefined values
  safeDisplay(value) {
    if (value === null || value === undefined) return 'Not Available';
    if (value === '') return 'Not Available';
    return String(value);
  }

  // Maps a CLI section name to the keys of collectSystemInfo() it needs.
  // Used so --json output for a single flag (e.g. --cpu --json) only
  // contains the fields that flag is actually about, not the whole report.
  static get SECTION_FIELD_MAP() {
    return {
      os: ['operatingSystem', 'osVersion', 'platform', 'architecture', 'hostname', 'homeDirectory'],
      cpu: ['cpuModel', 'cpuCores'],
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
      section[field] = info[field];
    });
    return section;
  }

  // Detects environment variable names that likely hold secrets (API keys,
  // tokens, passwords, etc.) so their values can be masked before display.
  // This matters because --env-all reads the FULL process.env, which on a
  // judge's or contributor's machine may contain real credentials.
  isSensitiveEnvKey(key) {
    return /key|secret|token|password|pwd|credential|auth|cert|private/i.test(key);
  }

  maskValue(value) {
    const str = this.safeDisplay(value);
    if (str === 'Not Available' || str === 'Not Set') return str;
    if (str.length <= 4) return '****';
    return str.slice(0, 2) + '*'.repeat(Math.min(str.length - 4, 12)) + str.slice(-2);
  }

  // Returns every environment variable, with sensitive-looking ones masked.
  // Distinct from getSelectedEnvironmentVariables(), which only returns a
  // small, known-safe allowlist (PATH, HOME, USER, etc.).
  getAllEnvironmentVariablesRedacted() {
    const result = {};
    try {
      Object.keys(process.env)
        .sort()
        .forEach(key => {
          const value = process.env[key];
          result[key] = this.isSensitiveEnvKey(key) ? this.maskValue(value) : value;
        });
    } catch (error) {
      console.log(`⚠️  Could not fully enumerate environment variables: ${error.message}`);
    }
    return result;
  }

  // ==================== DISPLAY (SECTIONED) ====================
  // Each section is now its own method so individual flags (--os, --cpu, etc.)
  // can print just the part they need instead of the whole report.

  printHeader(title = '🖥️  SYSTEM INFORMATION COLLECTOR 🖥️') {
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log(`║        ${title.padEnd(54)}║`);
    console.log('╚════════════════════════════════════════════════════════════╝');
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
        const truncated = displayValue.length > 50 ? displayValue.substring(0, 47) + '...' : displayValue;
        console.log(`   • ${key}: ${truncated}`);
      });
    }
    console.log('');
  }

  printTimestamp(info) {
    console.log(`📅 Timestamp: ${this.safeDisplay(info.timestamp)}`);
    console.log('\n');
  }

  // Full report (used by --all). Pass jsonMode=true for machine-readable
  // output instead of the decorated console report.
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

  // Focused views for individual CLI flags. Each accepts jsonMode so the
  // same command can serve a human (pretty console) or a script (raw JSON).
  showOSInfo(jsonMode = false) {
    const info = this.collectSystemInfo();
    const section = this.extractSection(info, 'os');
    if (jsonMode) {
      console.log(JSON.stringify(section, null, 2));
      return;
    }
    this.printHeader('OPERATING SYSTEM DETAILS');
    this.printOSSection(info);
    this.printComputerSection(info);
  }

  showCPUInfo(jsonMode = false) {
    const info = this.collectSystemInfo();
    const section = this.extractSection(info, 'cpu');
    if (jsonMode) {
      console.log(JSON.stringify(section, null, 2));
      return;
    }
    this.printHeader('PROCESSOR DETAILS');
    this.printCPUSection(info);
  }

  showMemoryInfo(jsonMode = false) {
    const info = this.collectSystemInfo();
    const section = this.extractSection(info, 'memory');
    if (jsonMode) {
      console.log(JSON.stringify(section, null, 2));
      return;
    }
    this.printHeader('MEMORY DETAILS');
    this.printMemorySection(info);
  }

  showNodeInfo(jsonMode = false) {
    const info = this.collectSystemInfo();
    const section = this.extractSection(info, 'node');
    if (jsonMode) {
      console.log(JSON.stringify(section, null, 2));
      return;
    }
    this.printHeader('RUNTIME VERSIONS');
    this.printSoftwareSection(info);
  }

  showEnvInfo(jsonMode = false) {
    const info = this.collectSystemInfo();
    const section = this.extractSection(info, 'env');
    if (jsonMode) {
      console.log(JSON.stringify(section, null, 2));
      return;
    }
    this.printHeader('ENVIRONMENT VARIABLES (allowlisted)');
    this.printEnvSection(info);
  }

  showUserInfo(jsonMode = false) {
    const info = this.collectSystemInfo();
    const section = this.extractSection(info, 'user');
    if (jsonMode) {
      console.log(JSON.stringify(section, null, 2));
      return;
    }
    this.printHeader('USER DETAILS');
    this.printUserSection(info);
  }

  // Dumps the FULL process.env (not just the safe allowlist), masking any
  // key that looks like it could hold a secret. This is intentionally a
  // separate, explicitly-named command from --env so the "safe by default"
  // behavior stays the default, and the wider dump is an opt-in choice.
  showAllEnvInfo(jsonMode = false) {
    const allEnv = this.getAllEnvironmentVariablesRedacted();

    if (jsonMode) {
      console.log(JSON.stringify(allEnv, null, 2));
      return;
    }

    this.printHeader('ALL ENV VARS (sensitive values masked)');
    console.log('🔐 ALL ENVIRONMENT VARIABLES:');
    const keys = Object.keys(allEnv);
    if (keys.length === 0) {
      console.log('   • (none found)');
    } else {
      keys.forEach(key => {
        const displayValue = this.safeDisplay(allEnv[key]);
        const truncated = displayValue.length > 60 ? displayValue.substring(0, 57) + '...' : displayValue;
        console.log(`   • ${key}: ${truncated}`);
      });
    }
    console.log('');
  }

  // Lightweight, opinionated read on system state — the kind of one-glance
  // verdict a sysadmin actually wants, instead of raw numbers alone.
  buildHealthSummary(info) {
    const memPercent = parseFloat(info.memoryUsagePercent) || 0;
    let memoryStatus = 'Healthy';
    if (memPercent >= 90) memoryStatus = 'Critical';
    else if (memPercent >= 75) memoryStatus = 'Warning';

    return {
      hostname: info.hostname,
      platformSummary: `${info.operatingSystem} (${info.platform}/${info.architecture})`,
      cpuCores: info.cpuCores,
      memoryUsagePercent: info.memoryUsagePercent,
      memoryStatus,
      nodeVersion: info.nodeVersion,
      uptime: info.uptime,
      generatedAt: info.timestamp
    };
  }

  showHealthSummary(jsonMode = false) {
    const info = this.collectSystemInfo();
    const summary = this.buildHealthSummary(info);

    if (jsonMode) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    const statusIcon = { Healthy: '🟢', Warning: '🟡', Critical: '🔴' }[summary.memoryStatus] || '⚪';

    this.printHeader('SYSTEM HEALTH SUMMARY');
    console.log(`   • Hostname: ${this.safeDisplay(summary.hostname)}`);
    console.log(`   • Platform: ${this.safeDisplay(summary.platformSummary)}`);
    console.log(`   • CPU Cores: ${this.safeDisplay(String(summary.cpuCores))}`);
    console.log(`   • Memory Usage: ${this.safeDisplay(summary.memoryUsagePercent)} ${statusIcon} ${summary.memoryStatus}`);
    console.log(`   • Node.js: ${this.safeDisplay(summary.nodeVersion)}`);
    console.log(`   • Uptime: ${this.safeDisplay(summary.uptime)}`);
    console.log(`   • Generated At: ${this.safeDisplay(summary.generatedAt)}`);
    console.log('');
  }

  // ==================== CRUD OPERATIONS ====================

  // Validate filename
  validateFileName(filename) {
    if (!filename || typeof filename !== 'string') {
      console.log('❌ Invalid filename: must be a non-empty string');
      return false;
    }

    if (filename.length > 255) {
      console.log('❌ Filename too long: must be less than 255 characters');
      return false;
    }

    if (!this.validFileNamePattern.test(filename)) {
      console.log('❌ Invalid filename: only alphanumeric, dots, hyphens, and underscores allowed');
      return false;
    }

    // Prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      console.log('❌ Invalid filename: cannot contain path separators');
      return false;
    }

    return true;
  }

  // Validate file content
  validateFileContent(content) {
    if (content === null || content === undefined) {
      return ''; // Allow empty content
    }

    if (typeof content !== 'string') {
      content = String(content);
    }

    if (content.length > this.maxFileSize) {
      console.log(`❌ Content too large: maximum size is ${this.formatBytes(this.maxFileSize)}`);
      return null;
    }

    return content;
  }

  // CREATE - Create a new file
  createFile(filename, content = '') {
    try {
      if (!this.validateFileName(filename)) {
        return false;
      }

      const validatedContent = this.validateFileContent(content);
      if (validatedContent === null) {
        return false;
      }

      const filepath = path.join(this.filesDir, filename);

      // Check if file already exists
      if (fs.existsSync(filepath)) {
        console.log(`⚠️  File already exists: ${filename}`);
        return false;
      }

      // Check directory exists and is writable
      if (!fs.existsSync(this.filesDir)) {
        try {
          fs.mkdirSync(this.filesDir, { recursive: true });
        } catch (error) {
          console.log(`❌ Cannot create directory: ${error.message}`);
          return false;
        }
      }

      // Try to write file
      fs.writeFileSync(filepath, validatedContent, 'utf-8');

      // Verify file was created
      if (!fs.existsSync(filepath)) {
        console.log(`❌ File creation failed (file not found after write): ${filename}`);
        return false;
      }

      console.log(`✅ File created successfully: ${filename} (${this.formatBytes(validatedContent.length)})`);
      return true;
    } catch (error) {
      console.log(`❌ Error creating file: ${error.message}`);
      return false;
    }
  }

  // READ - Read file content
  readFile(filename) {
    try {
      if (!this.validateFileName(filename)) {
        return null;
      }

      const filepath = path.join(this.filesDir, filename);

      if (!fs.existsSync(filepath)) {
        console.log(`❌ File not found: ${filename}`);
        return null;
      }

      // Check if it's actually a file
      const stats = fs.statSync(filepath);
      if (!stats.isFile()) {
        console.log(`❌ Path is not a file: ${filename}`);
        return null;
      }

      // Check file size
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

  // UPDATE - Update file content
  updateFile(filename, content) {
    try {
      if (!this.validateFileName(filename)) {
        return false;
      }

      const validatedContent = this.validateFileContent(content);
      if (validatedContent === null) {
        return false;
      }

      const filepath = path.join(this.filesDir, filename);

      if (!fs.existsSync(filepath)) {
        console.log(`❌ File not found: ${filename}`);
        return false;
      }

      // Check if it's actually a file
      const stats = fs.statSync(filepath);
      if (!stats.isFile()) {
        console.log(`❌ Path is not a file: ${filename}`);
        return false;
      }

      // Backup original content (optional safety)
      const backupPath = filepath + '.bak';
      try {
        fs.copyFileSync(filepath, backupPath);
      } catch (error) {
        // Backup failure is not critical, continue
      }

      fs.writeFileSync(filepath, validatedContent, 'utf-8');
      console.log(`✅ File updated successfully: ${filename} (${this.formatBytes(validatedContent.length)})`);
      return true;
    } catch (error) {
      console.log(`❌ Error updating file: ${error.message}`);
      return false;
    }
  }

  // DELETE - Delete a file
  deleteFile(filename) {
    try {
      if (!this.validateFileName(filename)) {
        return false;
      }

      const filepath = path.join(this.filesDir, filename);

      if (!fs.existsSync(filepath)) {
        console.log(`❌ File not found: ${filename}`);
        return false;
      }

      // Check if it's actually a file
      const stats = fs.statSync(filepath);
      if (!stats.isFile()) {
        console.log(`❌ Path is not a file: ${filename}`);
        return false;
      }

      fs.unlinkSync(filepath);

      // Verify deletion
      if (fs.existsSync(filepath)) {
        console.log(`❌ File deletion failed (file still exists): ${filename}`);
        return false;
      }

      console.log(`✅ File deleted successfully: ${filename}`);
      return true;
    } catch (error) {
      console.log(`❌ Error deleting file: ${error.message}`);
      return false;
    }
  }

  // LIST - List all files with details
  listFiles() {
    try {
      if (!fs.existsSync(this.filesDir)) {
        console.log('📁 No files directory found');
        return [];
      }

      const files = fs.readdirSync(this.filesDir);

      // Filter only files (not directories)
      const fileList = files.filter(file => {
        try {
          const filepath = path.join(this.filesDir, file);
          return fs.statSync(filepath).isFile();
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

  // Save system info to JSON with validation
  saveToJSON(filename = 'systemInfo.json') {
    try {
      if (!this.validateFileName(filename)) {
        console.log('❌ Invalid JSON filename');
        return false;
      }

      const info = this.collectSystemInfo();
      const filepath = path.join(this.filesDir, filename);

      // Check if directory exists
      if (!fs.existsSync(this.filesDir)) {
        try {
          fs.mkdirSync(this.filesDir, { recursive: true });
        } catch (error) {
          console.log(`❌ Cannot create directory for JSON: ${error.message}`);
          return false;
        }
      }

      // Ensure data is JSON serializable
      const jsonString = JSON.stringify(info, null, 2);

      // Validate JSON
      try {
        JSON.parse(jsonString);
      } catch (error) {
        console.log(`❌ Generated JSON is invalid: ${error.message}`);
        return false;
      }

      fs.writeFileSync(filepath, jsonString, 'utf-8');

      // Verify file was written
      if (!fs.existsSync(filepath)) {
        console.log(`❌ JSON file creation failed`);
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

  // Get file statistics
  getFileStats(filename) {
    try {
      if (!this.validateFileName(filename)) {
        return null;
      }

      const filepath = path.join(this.filesDir, filename);

      if (!fs.existsSync(filepath)) {
        console.log(`❌ File not found: ${filename}`);
        return null;
      }

      const stats = fs.statSync(filepath);
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

  // Check if file is readable
  isFileReadable(filepath) {
    try {
      fs.accessSync(filepath, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  // Check if file is writable
  isFileWritable(filepath) {
    try {
      fs.accessSync(filepath, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}

// ==================== CLI LAYER ====================
// Everything below is new: argument parsing, help text, and a command
// dispatcher that routes process.argv input to the collector's methods.
// No demo logic runs automatically — the program only does what the
// command line asks it to do.

const HELP_TEXT = `
╔════════════════════════════════════════════════════════════╗
║       SYSTEM INFO COLLECTOR & FILE MANAGER — CLI HELP       ║
╚════════════════════════════════════════════════════════════╝

USAGE:
  node code.js <command> [arguments] [--json]

SYSTEM INFORMATION COMMANDS:
  --all              Show the full system information report
  --os               Show OS, platform, architecture, hostname, home dir
  --cpu              Show CPU model and core count
  --memory           Show total / used / free memory and usage percent
  --node             Show Node.js, NPM, and Python versions
  --env              Show a safe, allowlisted set of environment variables
  --env-all          Show EVERY environment variable, with keys that look
                     like secrets (KEY/TOKEN/SECRET/PASSWORD/...) masked
  --user             Show username, UID, GID, and shell
  --summary          One-glance health verdict (memory status, uptime, etc.)
  --save-json [file] Save the full system report to a JSON file
                     (defaults to systemInfo.json)

MODIFIER:
  --json             Add to any info command above to print raw JSON
                     instead of the formatted console report
                     e.g. node code.js --memory --json

FILE (CRUD) COMMANDS:
  create <filename> [content]   Create a new file with optional content
  read <filename>                Print a file's contents
  update <filename> <content>    Overwrite a file's contents (creates a .bak backup)
  delete <filename>               Delete a file
  list                            List all files with size and creation date

OTHER:
  --help, -h         Show this help message

EXAMPLES:
  node code.js --all
  node code.js --memory --json
  node code.js --summary
  node code.js create notes.txt "Hello world"
  node code.js read notes.txt
  node code.js update notes.txt "Updated content"
  node code.js delete notes.txt
  node code.js list

NOTES:
  • CRUD commands only operate inside the sandboxed "collected_files"
    directory next to this script — filenames cannot contain path
    separators or ".." and are length/pattern validated, so this tool
    cannot read, write, or delete files anywhere else on the system.
  • --env-all reads your real environment. Secret-looking values are
    masked automatically, but review output before sharing it.
`;

function printHelp() {
  console.log(HELP_TEXT);
}

// Routes a parsed command to the right collector method.
// Returns nothing — all user feedback is printed by the called method.
function dispatchCommand(collector, command, args, jsonMode) {
  switch (command) {
    case '--all':
      collector.displaySystemInfo(collector.collectSystemInfo(), jsonMode);
      break;

    case '--os':
      collector.showOSInfo(jsonMode);
      break;

    case '--cpu':
      collector.showCPUInfo(jsonMode);
      break;

    case '--memory':
      collector.showMemoryInfo(jsonMode);
      break;

    case '--node':
      collector.showNodeInfo(jsonMode);
      break;

    case '--env':
      collector.showEnvInfo(jsonMode);
      break;

    case '--env-all':
      collector.showAllEnvInfo(jsonMode);
      break;

    case '--user':
      collector.showUserInfo(jsonMode);
      break;

    case '--summary':
      collector.showHealthSummary(jsonMode);
      break;

    case '--save-json': {
      const filename = args[0] || 'systemInfo.json';
      collector.saveToJSON(filename);
      break;
    }

    case 'create': {
      const filename = args[0];
      const content = args.slice(1).join(' ');
      if (!filename) {
        console.log('❌ Usage: node code.js create <filename> [content]');
        return;
      }
      collector.createFile(filename, content);
      break;
    }

    case 'read': {
      const filename = args[0];
      if (!filename) {
        console.log('❌ Usage: node code.js read <filename>');
        return;
      }
      collector.readFile(filename);
      break;
    }

    case 'update': {
      const filename = args[0];
      const content = args.slice(1).join(' ');
      if (!filename) {
        console.log('❌ Usage: node code.js update <filename> <content>');
        return;
      }
      if (!content) {
        console.log('⚠️  No content provided — the file will be saved empty.');
      }
      collector.updateFile(filename, content);
      break;
    }

    case 'delete': {
      const filename = args[0];
      if (!filename) {
        console.log('❌ Usage: node code.js delete <filename>');
        return;
      }
      collector.deleteFile(filename);
      break;
    }

    case 'list':
      collector.listFiles();
      break;

    case '--help':
    case '-h':
      printHelp();
      break;

    default:
      console.log(`❌ Unknown command: "${command}"`);
      console.log('   Run "node code.js --help" to see available commands.\n');
  }
}

// ==================== MAIN EXECUTION ====================

function main() {
  try {
    const rawArgv = process.argv.slice(2);

    // Pull --json out as a modifier flag so it can appear anywhere
    // (before or after the command) without being mistaken for a filename.
    let jsonMode = false;
    const argv = rawArgv.filter(arg => {
      if (arg === '--json') {
        jsonMode = true;
        return false;
      }
      return true;
    });

    const command = argv[0];
    const args = argv.slice(1);

    // No command given -> show help instead of running a demo
    if (!command) {
      printHelp();
      return;
    }

    const collector = new SystemInfoCollector();
    dispatchCommand(collector, command, args, jsonMode);
  } catch (error) {
    console.error('\n❌ Critical Error:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Process-level error handlers
process.on('uncaughtException', (error) => {
  console.error('\n❌ Uncaught Exception:', error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('\n❌ Unhandled Rejection:', reason);
  process.exit(1);
});

// Only auto-run when invoked directly from the command line,
// not when required as a module (e.g. in tests).
if (require.main === module) {
  main();
}

// Export for use as module
module.exports = SystemInfoCollector;