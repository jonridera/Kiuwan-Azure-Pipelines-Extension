//LS: new libraries
const tl = require('azure-pipelines-task-lib/task');
const ttl = require('azure-pipelines-tool-lib/tool');
const trm = require('azure-pipelines-task-lib/toolrunner');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { _exist } = require('azure-pipelines-task-lib/internal');
const PropertiesReader = require('properties-reader');

// --- Utility Functions ---

function isBuild() {
    const s = tl.getVariable("System.HostType");
    return s === "build";
}

async function getLastAnalysisResults(kiuwanUrl, kiuwanUser, kiuwanPassword, domainId, kiuwanEndpoint, klaAgentProperties) {
    const method = 'GET';
    const auth = `${kiuwanUser}:${kiuwanPassword}`;
    const encodedPath = encodeURI(kiuwanEndpoint);

    // Get proxy from agent
    let agent_proxy_conf = tl.getHttpProxyConfiguration() || {};
    let property_proxy_host = "";
    let property_proxy_port = "";
    let property_proxy_auth = "";
    let property_proxy_un = "";
    let property_proxy_pw = "";

    if (agent_proxy_conf.proxyUrl) {
        const agentProxyUrl = agent_proxy_conf.proxyUrl;
        property_proxy_host = agentProxyUrl.slice(agentProxyUrl.indexOf("://") + 3, agentProxyUrl.lastIndexOf(":"));
        property_proxy_port = agentProxyUrl.slice(agentProxyUrl.lastIndexOf(":") + 1);
        if (agent_proxy_conf.proxyUsername) {
            property_proxy_auth = "Basic";
            property_proxy_un = agent_proxy_conf.proxyUsername;
            property_proxy_pw = agent_proxy_conf.proxyPassword || "";
        } else {
            property_proxy_auth = "None";
        }
    }

    let use_proxy = property_proxy_host && property_proxy_host !== "null";
    let proxy_auth = property_proxy_auth === "Basic";

    let options = {
        protocol: kiuwanUrl.protocol,
        host: kiuwanUrl.host.split(':')[0],
        port: kiuwanUrl.port,
        path: encodedPath,
        method: method,
        rejectUnauthorized: false,
        auth: auth,
        headers: domainId && domainId !== "0" ? { 'X-KW-CORPORATE-DOMAIN-ID': domainId } : {}
    };

    if (kiuwanUrl.protocol === 'http:') {
        return callKiuwanApiHttp(options);
    } else if (kiuwanUrl.protocol === 'https:') {
        if (use_proxy) {
            if (proxy_auth) {
                const auth_p = 'Basic ' + Buffer.from(property_proxy_un + ':' + property_proxy_pw).toString('base64');
                return callKiuwanApiHttpsProxy(options, property_proxy_host, property_proxy_port, auth_p);
            } else {
                return callKiuwanApiHttpsProxyNoAuth(options, property_proxy_host, property_proxy_port);
            }
        } else {
            return callKiuwanApiHttps(options);
        }
    }
}

function saveKiuwanResults(result, type) {
    let fileName = type === "baseline" ? "kiuwanBaselineResult.json" : "kiuwanDeliveryResult.json";
    const resultsDirPath = path.join(tl.getVariable('build.artifactStagingDirectory'), '.kiuwanResults');
    const resultsFilePath = path.join(resultsDirPath, fileName);
    if (!_exist(resultsDirPath)) fs.mkdirSync(resultsDirPath);
    fs.writeFileSync(resultsFilePath, result);
    return resultsFilePath;
}

function uploadKiuwanResults(resultsPath, title, type) {
    const attachmentType = type === "baseline" ? "Kiuwantask.Baseline.Results" : "Kiuwantask.Delivery.Results";
    tl.command('task.addattachment', { type: attachmentType, name: title }, resultsPath);
}

// --- API Call Functions ---

async function callKiuwanApiHttpsProxy(options, proxy_host, proxy_port, proxy_auth) {
    return new Promise((resolve, reject) => {
        http.request({
            host: proxy_host,
            port: proxy_port,
            method: 'CONNECT',
            path: options.host + ":443",
            headers: { 'Proxy-Authorization': proxy_auth }
        }).on('connect', (res, socket) => {
            if (res.statusCode === 200) {
                https.get({ host: options.host, path: options.path, auth: options.auth, socket, agent: false }, (res) => {
                    let chunks = [];
                    res.on('data', c => chunks.push(c));
                    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
                    if (res.statusCode !== 200) reject(new Error(`Kiuwan call error (${res.statusCode})`));
                });
            } else {
                reject(new Error(`Proxy connection failed (${res.statusCode})`));
            }
        }).on('error', reject).end();
    });
}

async function callKiuwanApiHttpsProxyNoAuth(options, proxy_host, proxy_port) {
    return callKiuwanApiHttpsProxy(options, proxy_host, proxy_port, '');
}

async function callKiuwanApiHttps(options) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.end();
    });
}

async function callKiuwanApiHttp(options) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.end();
    });
}

// --- KLA Functions ---

async function getKlaAgentPropertiesPath(klaPath, platform) {
    const dir = platform === 'linux' || platform === 'darwin' ? `${klaPath}/KiuwanLocalAnalyzer` : `${klaPath}\\KiuwanLocalAnalyzer`;
    return _exist(dir) ? path.join(dir, 'conf', 'agent.properties') : '';
}

async function buildKlaCommand(klaPath, platform) {
    const dir = platform === 'linux' || platform === 'darwin' ? `${klaPath}/KiuwanLocalAnalyzer` : `${klaPath}\\KiuwanLocalAnalyzer`;
    return _exist(dir) ? path.join(dir, 'bin', platform === 'linux' || platform === 'darwin' ? 'agent.sh' : 'agent.cmd') : '';
}

async function downloadInstallKla(endpointConnectionName, toolName, toolVersion, platform) {
    let toolPath = ttl.findLocalTool(toolName, toolVersion);
    if (!toolPath) {
        const downloadUrl = tl.getEndpointUrl(endpointConnectionName, false) + '/pub/analyzer/KiuwanLocalAnalyzer.zip';
        const downloadPath = await ttl.downloadTool(downloadUrl, 'KiuwanLocalAnalyzer.zip');
        const extPath = await ttl.extractZip(downloadPath);
        toolPath = await ttl.cacheDir(extPath, toolName, toolVersion);
        if (platform === 'linux' || platform === 'darwin') {
            await tl.exec('chmod', `+x ${toolPath}/KiuwanLocalAnalyzer/bin/agent.sh`);
        }
    }
    return toolPath;
}

async function runKiuwanLocalAnalyzer(command, args) {
    let kiuwan = tl.tool(command).line(args);
    const options = { cwd: '.', env: process.env, silent: false, windowsVerbatimArguments: false, failOnStdErr: false };
    kiuwan.on('stdout', data => tl.debug(data.toString().trim()));
    return kiuwan.exec(options);
}

// --- Agent Directories ---

function setAgentTempDir(agentHomeDir, platform) {
    const tempDir = platform === 'linux' || platform === 'darwin' ? `${agentHomeDir}/_temp` : `${agentHomeDir}\\_temp`;
    if (!_exist(tempDir)) fs.mkdirSync(tempDir);
    tl.setVariable('Agent.TempDirectory', tempDir);
    return tempDir;
}

function setAgentToolsDir(agentHomeDir, platform) {
    const toolsDir = platform === 'linux' || platform === 'darwin' ? `${agentHomeDir}/_tools` : `${agentHomeDir}\\_tools`;
    tl.setVariable('Agent.ToolsDirectory', toolsDir);
    return toolsDir;
}

// --- Kiuwan Result Messages ---

function getKiuwanRetMsg(kiuwanRetCode) {
    const msgs = {
        1: `KLA Error ${kiuwanRetCode}: Analyzer execution error.`,
        10: `KLA Error ${kiuwanRetCode}: Audit overall result = FAIL.`,
        11: `KLA Error ${kiuwanRetCode}: Invalid analysis configuration.`,
        12: `KLA Error ${kiuwanRetCode}: Model does not support discovered languages.`,
        13: `KLA Error ${kiuwanRetCode}: Timeout waiting for analysis results.`,
        14: `KLA Error ${kiuwanRetCode}: Analysis finished with error in Kiuwan.`,
        15: `KLA Error ${kiuwanRetCode}: Timeout: killed subprocess.`,
        16: `KLA Error ${kiuwanRetCode}: Account limits exceeded.`,
        17: `KLA Error ${kiuwanRetCode}: Delivery analysis not permitted.`,
        18: `KLA Error ${kiuwanRetCode}: No analyzable extensions found.`,
        19: `KLA Error ${kiuwanRetCode}: Error checking license.`,
        22: `KLA Error ${kiuwanRetCode}: Access denied.`,
        23: `KLA Error ${kiuwanRetCode}: Bad Credentials.`,
        24: `KLA Error ${kiuwanRetCode}: Application Not Found.`,
        25: `KLA Error ${kiuwanRetCode}: Limit Exceeded for Calls.`,
        26: `KLA Error ${kiuwanRetCode}: Quota Limit Reached.`,
        27: `KLA Error ${kiuwanRetCode}: Analysis Not Found.`,
        28: `KLA Error ${kiuwanRetCode}: Application already exists.`,
        30: `KLA Error ${kiuwanRetCode}: Delivery analysis not permitted: baseline missing.`,
        31: `KLA Error ${kiuwanRetCode}: No engine available.`,
        32: `KLA Error ${kiuwanRetCode}: Unexpected error.`,
        33: `KLA Error ${kiuwanRetCode}: Out of Memory.`,
        34: `KLA Error ${kiuwanRetCode}: JVM Error.`
    };
    return msgs[kiuwanRetCode] || `KLA returned ${kiuwanRetCode} Analysis finished successfully!`;
}

function auditFailed(retCode) { return retCode === 10; }
function noFilesToAnalyze(retCode) { return retCode === 18; }

// --- Agent Properties Processor ---

async function processAgentProperties(agent_properties_file, proxyUrl, proxyUser, proxyPassword) {
    let properties = PropertiesReader(agent_properties_file);
    let property_proxy_host = properties.get('proxy.host');
    let property_proxy_port = properties.get('proxy.port');
    let property_proxy_auth = properties.get('proxy.authentication');
    let property_proxy_un = properties.get('proxy.username');
    let property_proxy_pw = properties.get('proxy.password');
    let property_proxy_protocol = properties.get('proxy.protocol');

    if (proxyUrl && (proxyUrl.startsWith("socks") || proxyUrl.startsWith("http"))) {
        property_proxy_host = proxyUrl.slice(proxyUrl.indexOf("://") + 3, proxyUrl.lastIndexOf(":"));
        property_proxy_port = proxyUrl.slice(proxyUrl.lastIndexOf(":") + 1);
        property_proxy_protocol = proxyUrl.slice(0, proxyUrl.indexOf("://"));
        property_proxy_auth = proxyUser ? "Basic" : "None";
        property_proxy_un = proxyUser || "";
        property_proxy_pw = proxyPassword || "";
    } else {
        property_proxy_host = "";
        property_proxy_port = "3128";
        property_proxy_protocol = "http";
        property_proxy_auth = "None";
        property_proxy_un = "";
        property_proxy_pw = "";
    }

    let propString = fs.readFileSync(agent_properties_file, 'utf8');
    propString = replaceProperty(propString, "proxy.host", property_proxy_host);
    propString = replaceProperty(propString, "proxy.port", property_proxy_port);
    propString = replaceProperty(propString, "proxy.authentication", property_proxy_auth);
    propString = replacePropertyWithHack(propString, "proxy.username", property_proxy_un);
    propString = replaceProperty(propString, "proxy.password", property_proxy_pw);
    propString = replaceProperty(propString, "proxy.protocol", property_proxy_protocol);
    fs.writeFileSync(agent_properties_file, propString);
}

// --- Property Helpers ---

function replaceProperty(inString, propertyName, propertyNewValue) {
    const firstPos = inString.indexOf(propertyName);
    const lastPos = inString.indexOf("\n", firstPos);
    return inString.slice(0, firstPos) + propertyName + "=" + propertyNewValue + inString.slice(lastPos);
}

function replacePropertyWithHack(inString, propertyName, propertyNewValue) {
    ['\\t','\\v','\\0','\\b','\\f','\\n'].forEach(esc => {
        if (propertyNewValue.includes(esc)) {
            propertyNewValue = propertyNewValue.replaceAll(esc, `\\\\${esc.slice(1)}`);
        }
    });
    return replaceProperty(inString, propertyName, propertyNewValue);
}

// --- Exports ---

module.exports = {
    isBuild,
    getLastAnalysisResults,
    saveKiuwanResults,
    uploadKiuwanResults,
    callKiuwanApiHttpsProxy,
    callKiuwanApiHttpsProxyNoAuth,
    callKiuwanApiHttps,
    callKiuwanApiHttp,
    getKlaAgentPropertiesPath,
    buildKlaCommand,
    downloadInstallKla,
    runKiuwanLocalAnalyzer,
    setAgentTempDir,
    setAgentToolsDir,
    getKiuwanRetMsg,
    auditFailed,
    noFilesToAnalyze,
    processAgentProperties
};
