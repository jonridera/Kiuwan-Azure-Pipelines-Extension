const os = require('os');
const url = require('url');
const tl = require('azure-pipelines-task-lib/task');
const {
    buildKlaCommand, setAgentTempDir, setAgentToolsDir,
    downloadInstallKla, runKiuwanLocalAnalyzer, getKiuwanRetMsg,
    getLastAnalysisResults, saveKiuwanResults, uploadKiuwanResults,
    isBuild, getKlaAgentPropertiesPath, processAgentProperties
} = require('./kiuwan-common/utils');

const { debug } = require('azure-pipelines-task-lib/task');

// Print Node version executing the plugin
console.log("Node version: ", process.version);

var osPlat = os.platform();

var agentHomeDir = tl.getVariable('Agent.HomeDirectory');
var agentTempDir = tl.getVariable('Agent.TempDirectory');

if (!agentTempDir) {
    agentTempDir = setAgentTempDir(agentHomeDir, osPlat);
}
var agentToolsDir = tl.getVariable('Agent.ToolsDirectory');
if (!agentToolsDir) {
    agentToolsDir = setAgentToolsDir(agentHomeDir, osPlat);
}
const toolName = 'KiuwanLocalAnalyzer';
const toolVersion = '1.0.0';

// Return the correct path separator (\ for Windows, / for others) based on OS.
function getPathSeparator(osName) {
    return osName.startsWith("win") ? "\\" : "/";
}

async function run() {
    try {

        // Initialize the list of supported technologies for analysis.
        let technologies = 'abap,actionscript,aspnet,c,cobol,cpp,csharp,go,groovy,html,java,javascript,jcl,jsp,kotlin,natural,objectivec,oracleforms,other,perl,php,powerscript,python,rpg4,ruby,scala,sqlscript,swift,vb6,vbnet,xml';

        // Read the analysis label input, defaulting to empty if not provided.
        let analysisLabel = tl.getInput('analysislabel');
        if (analysisLabel == null) {
            analysisLabel = "";
        }

        // Determine whether to ignore clones and/or insights based on inputs.
        let includeinsight = tl.getBoolInput('includeinsight');
        let skipclones = tl.getBoolInput('skipclones');
        let ignoreclause = "";

        if (skipclones) {
            if (!includeinsight) {
                ignoreclause = "ignore=clones,insights";
            } else {
                ignoreclause = "ignore=clones";
            }
        } else {
            if (!includeinsight) {
                ignoreclause = "ignore=insights";
            }
        }

        // Read inputs for snippet and file upload flags.
        let uploadsnippets = tl.getBoolInput('uploadsnippets');
        let uploadfiles = tl.getBoolInput('uploadfiles');

        // Get file encoding, default to UTF-8.
        let encoding = tl.getInput('encoding');
        if (encoding == null) {
            encoding = "UTF-8";
        }

        // Get file include/exclude patterns, with defaults.
        let includePatterns = tl.getInput('includepatterns');
        if (includePatterns == null) {
            includePatterns = "**/*";
        }

        let excludePatterns = tl.getInput('excludepatterns');
        if (excludePatterns == null) {
            excludePatterns = "";
        }

        // Configure memory allocation and analysis timeout.
        let memory = tl.getInput('memory');
        if (memory == null) {
            memory = "1024";
        }
        memory += 'm';

        let timeout = tl.getInput('timeout') == null ? 60 : Number(tl.getInput('timeout'));
        timeout = timeout * 60000;

        // Append DB technology to the technology list if database analysis is enabled.
        let dbanalysis = tl.getBoolInput('dbanalysis');
        if (dbanalysis) {
            let dbtechnology = tl.getInput('dbtechnology');
            technologies += ',' + dbtechnology;
            debug(`Including database technology: ${dbtechnology}`);
            debug(`Analyzing technologies: ${technologies}`);
        }

        // Retrieve Kiuwan connection, URL, user, password, and domain ID.
        let kiuwanConnection = tl.getInput("kiuwanConnection", true);
        let kiuwanUrl = url.parse(tl.getEndpointUrl(kiuwanConnection, false));

        let kiuwanUser = tl.getVariable('KiuwanUser');
        if (!kiuwanUser) {
            kiuwanUser = tl.getEndpointAuthorizationParameter(kiuwanConnection, "username", false);
        }
        let kiuwanPasswd = tl.getVariable('KiuwanPasswd');
        if (!kiuwanPasswd) {
            kiuwanPasswd = tl.getEndpointAuthorizationParameter(kiuwanConnection, "password", false);
        }
        let kiuwanDomainId = tl.getVariable('KiuwanDomainId');
        if (!kiuwanDomainId) {
            kiuwanDomainId = tl.getEndpointDataParameter(kiuwanConnection, "domainid", true);
        }
        debug(`[KW] Kiuwan auth domain: ${kiuwanDomainId}`);

        // Get build number and branch name.
        let buildNumber = tl.getVariable('Build.BuildNumber');
        let sourceBranchName = tl.getVariable('Build.SourceBranchName');

        // Determine application/project name from pipeline or user input.
        let projectSelector = tl.getInput('projectnameselector');
        let projectName = '';
        if (projectSelector === 'default') {
            projectName = tl.getVariable('System.TeamProject');
            console.log(`[KW] Kiuwan application from System.TeamProject: ${projectName}`);
        }
        if (projectSelector === 'kiuwanapp') {
            projectName = tl.getInput('kiuwanappname');
            console.log(`[KW] Kiuwan application from Kiuwan app list: ${projectName}`);
        }
        if (projectSelector === 'appname') {
            projectName = tl.getInput('customappname');
            console.log(`[KW] Kiuwan application from user input: ${projectName}`);
        }

        // Get source directory, handling build vs. release scenarios.
        let sourceDirectory = tl.getVariable('Build.SourcesDirectory');
        if (!isBuild()) {
            console.log(`[KW] This is a release.`);
            let primaryArtifactSourceAlias = tl.getVariable('Release.PrimaryArtifactSourceAlias');

            if (!primaryArtifactSourceAlias) {
                console.log("[KW] Release.PrimaryArtifactSourceAlias not set... Trying project name");
                primaryArtifactSourceAlias = tl.getVariable('Build.ProjectName');
            }
            sourceDirectory = tl.getVariable('Agent.ReleaseDirectory') +
                getPathSeparator(osPlat) +
                primaryArtifactSourceAlias;
        }
        console.log(`[KW] Kiuwan sourcecode directory: ${sourceDirectory}`);

        // Download, install, and locate Kiuwan Local Analyzer and its config files.
        let klaInstallPath = await downloadInstallKla(kiuwanConnection, toolName, toolVersion, osPlat);
        let kla = await buildKlaCommand(klaInstallPath, osPlat);
        let klaAgentProperties = await getKlaAgentPropertiesPath(klaInstallPath, osPlat);

        let agent_proxy_conf = tl.getHttpProxyConfiguration() || {};
        console.log(`[BT] Agent proxy url: ${agent_proxy_conf.proxyUrl}`);
        console.log(`[BT] Agent proxy user: ${agent_proxy_conf.proxyUsername}`);
        //console.log(`[BT] Agent proxy password: ${agent_proxy_conf.proxyPassword}`);

        // Retrieve agent proxy settings and update agent properties.
        let proxyUrl = agent_proxy_conf.proxyUrl || "";
        let proxyUser = agent_proxy_conf.proxyUsername || "";
        let proxyPassword = agent_proxy_conf.proxyPassword || "";

        await processAgentProperties(klaAgentProperties, proxyUrl, proxyUser, proxyPassword);

        // Build analyzer arguments for include/exclude patterns and encoding.
        let advancedArgs = "";
        let overrideDotKiuwan = tl.getBoolInput('overridedotkiuwan');

        if (overrideDotKiuwan) {
            advancedArgs = `.kiuwan.analysis.excludesPattern=${excludePatterns} ` +
                `.kiuwan.analysis.includesPattern=${includePatterns} ` +
                `.kiuwan.analysis.encoding=${encoding}`;
        } else {
            advancedArgs = `exclude.patterns=${excludePatterns} ` +
                `include.patterns=${includePatterns} ` +
                `encoding=${encoding}`;
        }

        // Add application model argument if overriding is enabled.
        let overrideModel = tl.getBoolInput('overrideappmodel');
        let appModel = tl.getInput('appmodel');
        let modelOption = ' ';
        if (overrideModel) {
            console.log(`[KW] OverrideModel ${overrideModel} value ${appModel}.`);
            modelOption = `--model-name "${appModel}" `;
        } else {
            console.log(`[KW] OverrideModel ${overrideModel}.`);
        }

        // Add domain ID argument if provided.
        let domainOption = ' ';
        if (kiuwanDomainId && kiuwanDomainId !== "0") {
            domainOption = `--domain-id ${kiuwanDomainId} `;
        }
        debug(`[KW] Domain option: ${domainOption}`);
        debug(`[KW] Model option: ${modelOption}`);

        // Construct the complete command-line arguments for analysis.
        let klaArgs =
            `-n "${projectName}" ` +
            `-s "${sourceDirectory}" ` +
            `-l "${analysisLabel} ${sourceBranchName} ${buildNumber}" ` +
            '-c ' +
            '-wr ' +
            `--user "${kiuwanUser}" ` +
            `--pass ${kiuwanPasswd} ` +
            `${domainOption}` +
            `${modelOption}` +
            `${advancedArgs} ` +
            `supported.technologies=${technologies} ` +
            `memory.max=${memory} ` +
            `timeout=${timeout} ` +
            `dump.code=${uploadsnippets} ` +
            `upload.analyzed.code=${uploadfiles} ` +
            `${ignoreclause}`;

        console.log(`[KW] Running Kiuwan analysis: ${kla} ${klaArgs}`);

        // Execute the analyzer with the assembled arguments.
        let kiuwanRetCode = await runKiuwanLocalAnalyzer(kla, klaArgs);
        let kiuwanMsg = getKiuwanRetMsg(kiuwanRetCode);

        if (kiuwanRetCode === 0) {
            if (!isBuild()) {
                // Release: mark success, skip results fetch.
                console.log("[KW] this is a release, skipping results fetch");
                tl.setResult(tl.TaskResult.Succeeded, kiuwanMsg + ", Results uploaded to Kiuwan.");
            } else {
                // Build: fetch last analysis results, save them, upload as pipeline attachments, mark success.
                let kiuwanEndpoint = `/saas/rest/v1/apps/${projectName}`;
                let kiuwanAnalysisResult = await getLastAnalysisResults(
                    kiuwanUrl,
                    kiuwanUser,
                    kiuwanPasswd,
                    kiuwanDomainId,
                    kiuwanEndpoint,
                    klaAgentProperties
                );

                tl.debug(`[KW] Result of last analysis for ${projectName}: ${kiuwanAnalysisResult}`);

                const kiuwanResultsPath = saveKiuwanResults(`${kiuwanAnalysisResult}`, "baseline");

                uploadKiuwanResults(kiuwanResultsPath, 'Kiuwan Baseline Results', "baseline");

                tl.setResult(tl.TaskResult.Succeeded, kiuwanMsg + ", Results uploaded.");
            }
        } else {
            // Failure: mark task as failed with error message.
            tl.setResult(tl.TaskResult.Failed, kiuwanMsg); 
        }
    } catch (err) {
        // Unexpected errors: log them, and mark the task as failed.
        tl.setResult(tl.TaskResult.Failed, err.message);
        console.error('[KW] Task failed: ' + err.message);
    }
}

run();
