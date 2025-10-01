const os = require('os');
const url = require('url');
const tl = require('azure-pipelines-task-lib/task');
const {
    buildKlaCommand, setAgentTempDir, setAgentToolsDir,
    downloadInstallKla, runKiuwanLocalAnalyzer, getKiuwanRetMsg,
    auditFailed, getLastAnalysisResults, saveKiuwanResults,
    uploadKiuwanResults, noFilesToAnalyze, isBuild, getKlaAgentPropertiesPath, processAgentProperties
} = require('./kiuwan-common/utils');

const { debug } = require('azure-pipelines-task-lib/task');

// Print Node Version
console.log("Node version:", process.version);

const osPlat = os.platform();
const agentHomeDir = tl.getVariable('Agent.HomeDirectory');
let agentTempDir = tl.getVariable('Agent.TempDirectory');
if (!agentTempDir) {
    agentTempDir = setAgentTempDir(agentHomeDir, osPlat);
}
let agentToolsDir = tl.getVariable('Agent.ToolsDirectory');
if (!agentToolsDir) {
    agentToolsDir = setAgentToolsDir(agentHomeDir, osPlat);
}
const toolName = 'KiuwanLocalAnalyzer';
const toolVersion = '1.0.0';

const inBuild = isBuild();
console.log("[KW] in build?: " + inBuild);

if (inBuild) {
    console.log('[KW] Running build logic...');
    run();
} else {
    console.log('[KW] Running release logic... Exiting, basically!');
    exit();
}

async function run() {
    try {
        // Initialize the list of supported technologies for analysis.
        let technologies = 'abap,actionscript,aspnet,c,cobol,cpp,csharp,go,groovy,html,java,javascript,jcl,jsp,kotlin,natural,objectivec,oracleforms,other,perl,php,powerscript,python,rpg4,ruby,scala,sqlscript,swift,vb6,vbnet,xml';

        // Collect pipeline task inputs
        let changeRequest = tl.getInput('changerequest') || "";
        const failOnAudit = tl.getBoolInput('failonaudit');
        const failOnNoFiles = tl.getBoolInput('failonnofiles');

        const includeinsight = tl.getBoolInput('includeinsight');
        const skipclones = tl.getBoolInput('skipclones');
        let ignoreclause = "ignoreOnDelivery=architecture";

        // Determine whether to ignore clones and/or insights based on inputs.
        if (skipclones) {
            if (!includeinsight) {
                ignoreclause = "ignoreOnDelivery=clones,insights,architecture";
            } else {
                ignoreclause = "ignoreOnDelivery=clones,architecture";
            }
        } else {
            if (!includeinsight) {
                ignoreclause = "ignoreOnDelivery=insights,architecture";
            }
        }

        const analysisScope = tl.getInput('analysisscope');
        const crStatus = tl.getInput('crstatus');

        // Get file encoding, default to UTF-8.
        let encoding = tl.getInput('encoding') || "UTF-8";
        let includePatterns = tl.getInput('includepatterns') || "**/*";
        let excludePatterns = tl.getInput('excludepatterns') || "";

        // Configure memory allocation and analysis timeout.
        let memory = tl.getInput('memory') || "1024";
        memory += 'm';
        
        let timeout = tl.getInput('timeout') == null ? 60 : Number(tl.getInput('timeout'));
        timeout = timeout * 60000;

        // Append DB technology to the technology list if database analysis is enabled.
        if (tl.getBoolInput('dbanalysis')) {
            let dbtechnology = tl.getInput('dbtechnology');
            technologies += ',' + dbtechnology;
            debug("Including database technology: " + dbtechnology);
            debug("Analyzing technologies: " + technologies);
        }

        // Retrieve Kiuwan connection, URL, user, password, and domain ID.
        const kiuwanConnection = tl.getInput("kiuwanConnection", true);
        const kiuwanUrl = url.parse(tl.getEndpointUrl(kiuwanConnection, false));

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
        debug("[KW] Kiuwan domain: " + kiuwanDomainId);

        // Read inputs for snippet and file upload flags.
        const uploadsnippets = tl.getBoolInput('uploadsnippets');
        const uploadfiles = tl.getBoolInput('uploadfiles');

        // Get build number and branch name.
        const buildNumber = tl.getVariable('Build.BuildNumber');
        const branch = tl.getVariable('Build.SourceBranch');
        const branchName = tl.getVariable('Build.SourceBranchName');
        const overridelabel = tl.getBoolInput('overridedeliverylabel');
        let deliveryLabel = "";

        // Add application model argument if overriding is enabled.
        if (!overridelabel) {
            let buildReason = tl.getVariable("Build.Reason");
            if (buildReason === undefined || buildReason === null) {
                buildReason = "Manual";
            }            
            console.log("BuildReason: " + buildReason);

            let repositoryType = tl.getVariable("Build.Repository.Provider");
            switch (repositoryType) {
                case "TfsVersionControl": {
                    let ChangeSet = tl.getVariable("Build.SourceVersion");
                    let ChangeSetMsg = tl.getVariable("Build.SourceVersionMessage");
                    let shelveSet = tl.getVariable("Build.SourceTfvcShelveset");
                    if (buildReason === "ValidateShelveset" || buildReason === "CheckInShelveset") {
                        deliveryLabel = shelveSet + " Build " + buildNumber;
                    } else if (buildReason.indexOf("CI") !== -1) {
                        deliveryLabel = "C" + ChangeSet + ": " + ChangeSetMsg + " Build: " + buildNumber;
                    } else {
                        deliveryLabel = branchName + " Build " + buildNumber;
                    }
                    break;
                }
                case "Git":
                case "GitHub":
                case "TfsGit": {
                    let commitId = tl.getVariable("Build.SourceVersion");
                    let commitMsg = tl.getVariable("Build.SourceVersionMessage");
                    if (buildReason === "PullRequest" || buildReason.indexOf("CI") !== -1) {
                        deliveryLabel = commitId + ": " + commitMsg + " Build " + buildNumber;
                    } else {
                        deliveryLabel = branchName + " Build " + buildNumber;
                    }
                    break;
                }
                case "Svn": {
                    deliveryLabel = branchName + " Build " + buildNumber;
                    break;
                }
                default:
                    deliveryLabel = branchName + " Build " + buildNumber;
            }
        } else {
            deliveryLabel = tl.getInput("deliverylabel");
        }

        let projectSelector = tl.getInput('projectnameselector');
        let projectName = '';
        if (projectSelector === 'default') {
            projectName = tl.getVariable('System.TeamProject');
            console.log("Kiuwan application from System.TeamProject: " + projectName);
        }
        if (projectSelector === 'kiuwanapp') {
            projectName = tl.getInput('kiuwanappname');
            console.log("Kiuwan application from Kiuwan app list: " + projectName);
        }
        if (projectSelector === 'appname') {
            projectName = tl.getInput('customappname');
            console.log("Kiuwan application from user input: " + projectName);
        }

        let sourceDirectory = tl.getVariable('Build.SourcesDirectory');
        if (analysisScope === "partialDelivery") {
            let altSourceDirectory = tl.getInput('alternativesourcedir');
            if (altSourceDirectory) {
                sourceDirectory = altSourceDirectory;
            }
        }

        // Download, install, and locate Kiuwan Local Analyzer and its config files.
        const klaInstallPath = await downloadInstallKla(kiuwanConnection, toolName, toolVersion, osPlat);
        const kla = await buildKlaCommand(klaInstallPath, osPlat);
        const klaAgentProperties = await getKlaAgentPropertiesPath(klaInstallPath, osPlat);

        let agent_proxy_conf = tl.getHttpProxyConfiguration();
        console.log("[DT] Agent proxy url: " + (agent_proxy_conf && agent_proxy_conf.proxyUrl));
        console.log("[DT] Agent proxy user: " + (agent_proxy_conf && agent_proxy_conf.proxyUsername));
        //console.log("[DT] Agent proxy password: " + (agent_proxy_conf && agent_proxy_conf.proxyPassword));

        // Retrieve agent proxy settings and update agent properties.
        let proxyUrl = "";
        let proxyUser = "";
        let proxyPassword = "";
        if (agent_proxy_conf && agent_proxy_conf.proxyUrl) {
            proxyUrl = agent_proxy_conf.proxyUrl;
            if (agent_proxy_conf.proxyUsername) proxyUser = agent_proxy_conf.proxyUsername;
            if (agent_proxy_conf.proxyPassword) proxyPassword = agent_proxy_conf.proxyPassword;
        }

        await processAgentProperties(klaAgentProperties, proxyUrl, proxyUser, proxyPassword);

        // Build analyzer arguments for include/exclude patterns and encoding.
        let advancedArgs = "";
        if (tl.getBoolInput('overridedotkiuwan')) {
            advancedArgs = `.kiuwan.analysis.excludesPattern=${excludePatterns} ` +
                `.kiuwan.analysis.includesPattern=${includePatterns} ` +
                `.kiuwan.analysis.encoding=${encoding}`;
        } else {
            advancedArgs = `exclude.patterns=${excludePatterns} ` +
                `include.patterns=${includePatterns} ` +
                `encoding=${encoding}`;
        }

        // Add domain ID argument if present.
        let domainOption = ' ';
        if (kiuwanDomainId && kiuwanDomainId !== "0") {
            domainOption = `--domain-id ${kiuwanDomainId} `;
        }
        debug("[KW] Domain option: " + domainOption);

        let klaArgs =
            `-n "${projectName}" ` +
            `-s "${sourceDirectory}" ` +
            `-l "${deliveryLabel}" ` +
            `-as ${analysisScope} ` +
            `-crs ${crStatus} ` +
            `-cr "${changeRequest}" ` +
            `-bn "${branch}" ` +
            '-wr ' +
            `--user "${kiuwanUser}" ` +
            `--pass ${kiuwanPasswd} ` +
            domainOption +
            advancedArgs + " " +
            `supported.technologies=${technologies} ` +
            `memory.max=${memory} ` +
            `timeout=${timeout} ` +
            `dump.code=${uploadsnippets} ` +
            `upload.analyzed.code=${uploadfiles} ` +
            ignoreclause;

        console.log("Running Kiuwan analysis");
        console.log(kla + " " + klaArgs);

        // Execute the analyzer with the assembled arguments.
        let kiuwanRetCode = await runKiuwanLocalAnalyzer(kla, klaArgs);
        let kiuwanMsg = getKiuwanRetMsg(kiuwanRetCode);

        if (kiuwanRetCode === 0 || auditFailed(kiuwanRetCode)) {
            let kiuwanEndpoint = `/saas/rest/v1/apps/${projectName}/deliveries?changeRequest=${changeRequest}&label=${deliveryLabel}`;
            let kiuwanDeliveryResult = await getLastAnalysisResults(kiuwanUrl, kiuwanUser, kiuwanPasswd, kiuwanDomainId, kiuwanEndpoint, klaAgentProperties);

            tl.debug("[KW] Result of last delivery for " + projectName + ": " + kiuwanDeliveryResult);

            const kiuwanResultsPath = saveKiuwanResults("" + kiuwanDeliveryResult, "delivery");
            uploadKiuwanResults(kiuwanResultsPath, 'Kiuwan Delivery Results', "delivery");
        }

        if (kiuwanRetCode === 0) {
            tl.setResult(tl.TaskResult.Succeeded, kiuwanMsg);
        } else {
            // Failure: mark task as failed with error message.
            if (auditFailed(kiuwanRetCode) && !failOnAudit) {
                tl.setResult(tl.TaskResult.Succeeded, kiuwanMsg);
            } else if (noFilesToAnalyze(kiuwanRetCode) && !failOnNoFiles) {
                tl.setResult(tl.TaskResult.Succeeded, kiuwanMsg);
            } else {
                tl.setResult(tl.TaskResult.Failed, kiuwanMsg);
            }
        }
    } catch (err) {
        // Unexpected errors: log them, and mark the task as failed.
        tl.setResult(tl.TaskResult.Failed, err.message);
        console.error("Task failed: " + err.message);
    }
}

async function exit() {
    tl.setResult(tl.TaskResult.SucceededWithIssues, "This task is for build pipelines only. Skipped...");
}
