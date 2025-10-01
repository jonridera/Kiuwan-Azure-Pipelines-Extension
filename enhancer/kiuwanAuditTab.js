var Controls = require("VSS/Controls");
// var VSS_Service = require("VSS/Service");
var TFS_Build_Contracts = require("TFS/Build/Contracts");
var TFS_Build_Extension_Contracts = require("TFS/Build/ExtensionContracts");

var DT_Client = require("TFS/DistributedTask/TaskRestClient");

var KiuwanAuditTab = /** @class */ (function (_super) {
    __extends(KiuwanAuditTab, _super);

    function KiuwanAuditTab() {
        var _this = _super.call(this) || this;
        _this.K_OK = "OK";
        _this.K_FAIL = "FAIL";
        return _this;
    }

    KiuwanAuditTab.prototype.initialize = function () {
        var _this = this;
        _super.prototype.initialize.call(this);

        var sharedConfig = VSS.getConfiguration();
        var vsoContext = VSS.getWebContext();

        if (sharedConfig) {
            sharedConfig.onBuildChanged(function (build) {
                _this._initKiuwanAuditTab(build);

                var taskClient = DT_Client.getClient();
                taskClient.getPlanAttachments(vsoContext.project.id, "build", build.orchestrationPlan.planId, "Kiuwantask.Delivery.Results")
                    .then(function (taskAttachments) {
                        if (taskAttachments.length === 0) {
                            _this._element.find("#disclaimer").show();
                        } else {
                            _this._element.find("#kiuwan-audit-tab").show();
                        }

                        $.each(taskAttachments, function (index, taskAttachment) {
                            taskClient.getAttachmentContent(
                                vsoContext.project.id,
                                "build",
                                build.orchestrationPlan.planId,
                                taskAttachment.timelineId,
                                taskAttachment.recordId,
                                taskAttachment.type,
                                taskAttachment.name
                            ).then(function (kiuwanResults) {
                                var kiuwanJsonStr = String.fromCharCode.apply(null, new Uint8Array(kiuwanResults));
                                var kiuwanJson = JSON.parse(kiuwanJsonStr);
                                var kiuwanAuditResult = kiuwanJson.auditResult.overallResult;

                                _this.setKiuwanAuditLink(kiuwanJson.auditResultURL);
                                _this.setAuditResult(kiuwanAuditResult);
                                _this.setAuditScore(kiuwanAuditResult, kiuwanJson.auditResult.score);
                                _this.setCheckpointSummary(kiuwanJson.auditResult.checkpointResults);

                                var fixStats = _this.getFixStats(kiuwanJson.auditResult.checkpointResults);
                                _this.setCheckpointList(kiuwanJson.auditResult.checkpointResults);
                                _this.setEffortSummary(fixStats);
                            });
                        });
                    });
            });
        }
    };

    KiuwanAuditTab.prototype.setEffortSummary = function (fixStats) {
        this._element.find("#effort-summary").html("You have " + fixStats.defects + " defects in " + fixStats.files + " files to fix<br />Total effort to fix the failed checkpoints: <strong>" + fixStats.effort + "</strong>");
    };

    KiuwanAuditTab.prototype._initKiuwanAuditTab = function (build) { };

    KiuwanAuditTab.prototype.setKiuwanAuditLink = function (url) {
        this._element.find("#kiuwan-link").attr("href", url);
    };

    KiuwanAuditTab.prototype.setAuditResult = function (auditResult) {
        var displayIcon = "";
        var resultTextElement = this._element.find("#result-text");

        if (auditResult === this.K_FAIL) {
            displayIcon = "images/ball-red.png";
            resultTextElement.addClass("fail");
        } else if (auditResult === this.K_OK) {
            displayIcon = "images/ball-green.png";
            resultTextElement.addClass("success");
        }

        this._element.find("#result-icon").attr("src", displayIcon);
        resultTextElement.text(auditResult);
    };

    KiuwanAuditTab.prototype.setAuditScore = function (auditResult, score) {
        var scoreNumElement = this._element.find("#score-num");

        if (auditResult === this.K_FAIL) {
            scoreNumElement.addClass("fail");
        } else if (auditResult === this.K_OK) {
            scoreNumElement.addClass("success");
        }

        scoreNumElement.text(score.toFixed(2));
    };

    KiuwanAuditTab.prototype.setCheckpointSummary = function (checkpointResults) {
        var totalCheckpoints = checkpointResults.length;
        var failedCheckpoints = 0;

        for (var i = 0; i < totalCheckpoints; i++) {
            var cpr = checkpointResults[i];
            if (cpr.result === this.K_FAIL) {
                ++failedCheckpoints;
            }
        }

        this._element.find("#checkpoints-summary").html(failedCheckpoints + " out of " + totalCheckpoints + " total checkpoints failed");
    };

    KiuwanAuditTab.prototype.setCheckpointList = function (checkpointResults) {
        while (checkpointResults.length !== 0) {
            var resultColor = "";
            var resultText = "";
            var cpr = checkpointResults.pop();
            var divElement = $("<div />");
            divElement.addClass("checkpoint");

            if (cpr.result === this.K_OK) {
                resultColor = "success";
                resultText = "Passed";
            } else if (cpr.result === this.K_FAIL) {
                resultColor = "fail";
                resultText = "Failed";
            }

            divElement.html(cpr.checkpoint + ": " + cpr.name + " <span class=\"" + resultColor + "\">" + resultText + "</span>");
            this._element.find("#checkpoints-list").append(divElement);
        }
    };

    KiuwanAuditTab.prototype.getFixStats = function (checkpointResults) {
        var totalHours = 0;
        var totalMins = 0;
        var totalEffort = "";
        var totalDefects = 0;
        var totalFiles = 0;
        var totalCheckpoints = checkpointResults.length;

        for (var i = 0; i < totalCheckpoints; i++) {
            var checkpoint = checkpointResults[i];
            if (checkpoint.result === this.K_FAIL) {
                var violatedRules = checkpoint.violatedRules;
                var totalViolatedRules = violatedRules.length;
                for (var j = 0; j < totalViolatedRules; j++) {
                    totalDefects += violatedRules[j].defectsCount;
                    totalFiles += violatedRules[j].filesCount;
                    var effort = violatedRules[j].effort;
                    if (effort.lastIndexOf("h") !== -1) {
                        totalHours += +effort.substring(0, effort.lastIndexOf("h"));
                        totalMins += +effort.substring(effort.lastIndexOf("h") + 1, effort.length);
                    } else {
                        totalMins += +effort.substring(0, effort.lastIndexOf("m"));
                    }
                }
            }
        }

        totalEffort = totalHours + " hours " + totalMins + " minutes";
        return { effort: totalEffort, defects: totalDefects, files: totalFiles };
    };

    return KiuwanAuditTab;
}(Controls.BaseControl));

KiuwanAuditTab.enhance(KiuwanAuditTab, $(".kiuwan-audit"), {});

// Notify the parent frame that the host has been loaded
VSS.notifyLoadSucceeded();
