//LS: new libraries
const tl = require('azure-pipelines-task-lib/task');
const ttl = require('azure-pipelines-tool-lib/tool');
const trm = require('azure-pipelines-task-lib/toolrunner');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { _exist } = require('azure-pipelines-task-lib/internal');
//var PropertiesReader = require('properties-reader');

// ------------------------ Basic Helpers ------------------------
function isBuild() {
    const s = tl.getVariable("System.HostType");
    return s === "build";
}

// ------------------------ Kiuwan API Calls ------------------------
async function getLastAnalysisResults(kiuwanUrl, kiuwanUser, kiuwanPassword, domainId, kiuwanEndpoint, klaAgentProperties) {
    const method = 'GET';
    const auth = `${kiuwanUser}:${kiuwanPassword}`;
    const encodedPath = encodeURI(kiuwanEndpoint);

    // Get proxy info from agent
    let property_proxy_host = "";
    let property_proxy_port = "";
    let property_proxy_auth = "";
    let property_proxy_un = "";
    let property_proxy_pw = "";

    const agent_proxy_conf = tl.getHttpProxyConfiguration();
    let agentProxyUrl = "", agentProxyUser = "", agentProxyPassword = "";
    if (agent_proxy_conf?.proxyUrl) agentProxyUrl = agent_proxy_conf.proxyUrl;
    if (agent_proxy_conf?.proxyUsername) agentProxyUser = agent_proxy_conf.proxyUsername;
    if (agent_proxy_conf?.proxyPassword) agentProxyPassword = agent_proxy_conf.proxyPassword;

    if (agentProxyUrl.length > 0 && (agentProxyUrl.startsWith("socks") || agentProxyUrl.startsWith("http"))) {
        property_proxy_host = agentProxyUrl.slice(agentProxyUrl.indexOf("://")+3, agentProxyUrl.lastIndexOf(":"));
        property_proxy_port = agentProxyUrl.slice(agentProxyUrl.lastIndexOf(":")+1);
        if (agentProxyUser) {
            property_proxy_auth = "Basic";
            property_proxy_un = agentProxyUser;
            property_proxy_pw = agentProxyPassword;
        } else {
            property_proxy_auth = "None";
        }
    }

    tl.debug(`[LS] Proxy server: ${property_proxy_host}, port: ${property_proxy_port}, user: ${property_proxy_un}`);

    const use_proxy = property_proxy_host && property_proxy_host !== "null";
    const proxy_auth = property_proxy_auth === "Basic";

    var options;
    var host = kiuwanUrl.host.includes(':') ? kiuwanUrl.host.split(':')[0] : kiuwanUrl.host;

    options = {
        protocol: kiuwanUrl.protocol,
        host: host,
        port: kiuwanUrl.port,
        path: encodedPath,
        method: method,
        rejectUnauthorized: false,
        auth: auth
    };

    if (domainId && domainId !== "0") options.headers = { 'X-KW-CORPORATE-DOMAIN-ID': domainId };

    if (kiuwanUrl.protocol === 'http:') return callKiuwanApiHttp(options);
    if (kiuwanUrl.protocol === 'https:') {
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

// ------------------------ Kiuwan Results ------------------------
function saveKiuwanResults(result, type) {
    let fileName = type === "baseline" ? "kiuwanBaselineResult.json" : type === "delivery" ? "kiuwanDeliveryResult.json" : "";
    const resultsDirPath = path.join(tl.getVariable('build.artifactStagingDirectory'), '.kiuwanResults');
    const resultsFilePath = path.join(resultsDirPath, fileName);

    if (!_exist(resultsDirPath)) fs.mkdirSync(resultsDirPath);
    fs.writeFileSync(resultsFilePath, result);
    return resultsFilePath;
}

function uploadKiuwanResults(resultsPath, title, type) {
    tl.debug(`[KW] Uploading Kiuwan results from ${resultsPath}`);
    let attachmentType = type === "baseline" ? "Kiuwantask.Baseline.Results" : type === "delivery" ? "Kiuwantask.Delivery.Results" : "";
    tl.command('task.addattachment', { type: attachmentType, name: title }, resultsPath);
    tl.debug('[KW] Results uploaded successfully');
}

// ------------------------ Proxy API Calls ------------------------
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
                https.get({ host: options.host, path: options.path, auth: options.auth, socket: socket, agent: false }, (res) => {
                    let chunks = [];
                    res.on('data', chunk => chunks.push(chunk));
                    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
                    res.on('error', err => reject(new Error(`Response error: ${err}`)));
                });
            } else reject(new Error(`Proxy connection error: ${res.statusCode}`));
        }).on('error', err => reject(new Error(`Proxy request error: ${err}`))).end();
    });
}

async function callKiuwanApiHttpsProxyNoAuth(options, proxy_host, proxy_port) {
    return new Promise((resolve, reject) => {
        http.request({ host: proxy_host, port: proxy_port, method: 'CONNECT', path: options.host + ":443" })
            .on('connect', (res, socket) => {
                if (res.statusCode === 200) {
                    https.get({ host: options.host, path: options.path, auth: options.auth, socket: socket, agent: false }, (res) => {
                        let chunks = [];
                        res.on('data', chunk => chunks.push(chunk));
                        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
                        res.on('error', err => reject(new Error(`Response error: ${err}`)));
                    });
                } else reject(new Error(`Proxy connection error: ${res.statusCode}`));
            }).on('error', err => reject(new Error(`Proxy request error: ${err}`))).end();
    });
}

async function callKiuwanApiHttps(options) {
    return new Promise((resolve, reject) => {
        let responseString = '';
        let req = https.request(options, res => {
            res.setEncoding('utf-8');
            res.on('data', chunk => responseString += chunk);
            res.on('end', () => resolve(responseString));
            res.on('error', err => reject(new Error(`Response error: ${err}`)));
        });
        req.on('error', e => reject(new Error(`Kiuwan API request error: ${e}`)));
        req.end();
    });
}

async function callKiuwanApiHttp(options) {
    return new Promise((resolve, reject) => {
        let responseString = '';
        let req = http.request(options, res => {
            res.setEncoding('utf-8');
            res.on('data', chunk => responseString += chunk);
            res.on('end', () => resolve(responseString));
            res.on('error', err => reject(new Error(`Response error: ${err}`)));
        });
        req.on('error', e => reject(new Error(`Kiuwan API request error: ${e}`)));
        req.end();
    });
}

// ------------------------ KLA Agent Helpers ------------------------
async function getKlaAgentPropertiesPath(klaPath, platform) {
    let defaultKiuwanDir = 'KiuwanLocalAnalyzer';
    let agentprops;
    if (platform === 'linux' || platform === 'darwin') {
        agentprops = _exist(`${klaPath}/${defaultKiuwanDir}`) ? `${klaPath}/${defaultKiuwanDir}/conf/agent.properties` : "";
    } else {
        agentprops = _exist(`${klaPath}\\${defaultKiuwanDir}`) ? `${klaPath}\\${defaultKiuwanDir}\\conf\\agent.properties` : "";
    }
    return agentprops;
}

async function buildKlaCommand(klaPath, platform) {
    let defaultKiuwanDir = 'KiuwanLocalAnalyzer';
    let command;
    if (platform === 'linux' || platform === 'darwin') {
        command = _exist(`${klaPath}/${defaultKiuwanDir}`) ? `${klaPath}/${defaultKiuwanDir}/bin/agent.sh` : "";
    } else {
        command = _exist(`${klaPath}\\${defaultKiuwanDir}`) ? `${klaPath}\\${defaultKiuwanDir}\\bin\\agent.cmd` : "";
    }
    return command;
}

async function downloadInstallKla(endpointConnectionName, toolName, toolVersion, platform) {
    let defaultKiuwanDir = 'KiuwanLocalAnalyzer';
    let toolPath = ttl.findLocalTool(toolName, toolVersion);

    if (!toolPath) {
        let downloadUrl = tl.getEndpointUrl(endpointConnectionName, false) + '/pub/analyzer/KiuwanLocalAnalyzer.zip';
        let downloadPath = await ttl.downloadTool(downloadUrl, 'KiuwanLocalAnalyzer.zip');
        let extPath = await ttl.extractZip(downloadPath);
        toolPath = await ttl.cacheDir(extPath, toolName, toolVersion);

        if (platform === 'linux' || platform === 'darwin') {
            await tl.exec('chmod', `+x ${toolPath}/${defaultKiuwanDir}/bin/agent.sh`);
        }
    }
    return toolPath;
}

async function runKiuwanLocalAnalyzer(command, args) {
    let kiuwan = tl.tool(command).line(args);
    let options = {
        cwd: '.',
        env: process.env,
        silent: false,
        windowsVerbatimArguments: false,
        failOnStdErr: false,
        errStream: process.stdout,
        outStream: process.stdout,
        ignoreReturnCode: true
    };

    kiuwan.on('stdout', data => tl.debug(data.toString().trim()));
    return await kiuwan.exec(options);
}

// ------------------------ Agent Directories ------------------------
function setAgentTempDir(agentHomeDir, platform) {
    let tempDir = platform === 'linux' || platform === 'darwin' ? `${agentHomeDir}/_temp` : `${agentHomeDir}\\_temp`;
    if (!_exist(tempDir)) fs.mkdirSync(tempDir);
    tl.setVariable('Agent.TempDirectory', tempDir);
    return tempDir;
}

function setAgentToolsDir(agentHomeDir, platform) {
    let toolsDir = platform === 'linux' || platform === 'darwin' ? `${agentHomeDir}/_tools` : `${agentHomeDir}\\_tools`;
    tl.setVariable('Agent.ToolsDirectory', toolsDir);
    return toolsDir;
}

// ------------------------ Kiuwan Return Messages ------------------------
function getKiuwanRetMsg(kiuwanRetCode) {
    switch (kiuwanRetCode) {
        case 1: return `KLA Error 1: Analyzer execution error.`;
        case 10: return `KLA Error 10: Audit overall result = FAIL.`;
        case 11: return `KLA Error 11: Invalid analysis configuration.`;
        case 12: return `KLA Error 12: Model does not support discovered languages.`;
        case 13: return `KLA Error 13: Timeout waiting for analysis results.`;
        case 14: return `KLA Error 14: Analysis finished with error in Kiuwan.`;
        case 15: return `KLA Error 15: Timeout: killed the subprocess.`;
        case 16: return `KLA Error 16: Account limits exceeded.`;
        case 17: return `KLA Error 17: Delivery analysis not permitted for current user.`;
        case 18: return `KLA Error 18: No analyzable extensions found.`;
        case 19: return `KLA Error 19: Error checking license.`;
        case 20: return `KLA Error 20: Error creating temporary directories.`;
        case 21: return `KLA Error 21: Analyzer disabled in this Kiuwan account.`;
        default: return `KLA Error: Unknown error code ${kiuwanRetCode}.`;
    }
}

// ------------------------ Export ------------------------
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
    getKiuwanRetMsg
};
