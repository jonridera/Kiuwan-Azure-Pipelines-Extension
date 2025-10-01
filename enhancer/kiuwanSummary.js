var Controls = require("VSS/Controls");
// var VSS_Service = require("VSS/Service");
var TFS_Build_Contracts = require("TFS/Build/Contracts");
var TFS_Build_Extension_Contracts = require("TFS/Build/ExtensionContracts");
var DT_Client = require("TFS/DistributedTask/TaskRestClient");

var KiuwanSummary = /** @class */ (function (_super) {
    __extends(KiuwanSummary, _super);

    function KiuwanSummary() {
        var _this = _super.call(this) || this;
        _this.K_FAIL = "FAIL";
        _this.K_OK = "OK";
        return _this;
    }

    KiuwanSummary.prototype.initialize = function () {
        var _this = this;
        _super.prototype.initialize.call(this);

        var sharedConfig = VSS.getConfiguration();
        var vsoContext = VSS.getWebContext();

        if (sharedConfig) {
            sharedConfig.onBuildChanged(function (build) {
                _this._initBuildInfo(build);

                var taskClient = DT_Client.getClient();

                // Baseline Results
                taskClient.getPlanAttachments(vsoContext.project.id, "build", build.orchestrationPlan.planId, "Kiuwantask.Baseline.Results")
                    .then(function (taskAttachments) {
                        if (taskAttachments.length !== 0) {
                            _this._element.find("#kiuwan-summary-content").show();
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
                                _this.setKiuwanResultsLink(kiuwanJson.analysisURL);
                                _this.populateSecuritySummary(kiuwanJson);
                                _this.populateQaSummary(kiuwanJson);
                            });
                        });
                    });

                // Delivery Results
                taskClient.getPlanAttachments(vsoContext.project.id, "build", build.orchestrationPlan.planId, "Kiuwantask.Delivery.Results")
                    .then(function (taskAttachments) {
                        if (taskAttachments.length !== 0) {
                            _this._element.find("#kiuwan-audit-content").show();
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
                            });
                        });
                    });
            });
        }
    };

    KiuwanSummary.prototype._initBuildInfo = function (build) { };

    KiuwanSummary.prototype.setKiuwanAuditLink = function (url) {
        this._element.find("#kiuwan-link").attr("href", url);
    };

    KiuwanSummary.prototype.setAuditResult = function (auditResult) {
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

    KiuwanSummary.prototype.setAuditScore = function (auditResult, score) {
        var scoreNumElement = this._element.find("#score-num");

        if (auditResult === this.K_FAIL) {
            scoreNumElement.addClass("fail");
        } else if (auditResult === this.K_OK) {
            scoreNumElement.addClass("success");
        }

        scoreNumElement.text(score.toFixed(2));
    };

    KiuwanSummary.prototype.setKiuwanResultsLink = function (url) {
        this._element.find("#kiuwan-link").attr("href", url);
    };

    KiuwanSummary.prototype.populateSecuritySummary = function (kiuwanJson) {
        if (kiuwanJson.Security !== undefined) {
            var starYes = '<img src="images/star-yes.png" />';
            var secRating = kiuwanJson.Security.Rating;

            for (var i = 1; i <= secRating; i++) {
                this._element.find("#sec-star-" + i).html(starYes);
            }
        } else {
            this._element.find("#sec-empty").html("There is no security info to display from Kiuwan<br />");
            this._element.find("#sec-summary").hide();
        }
    };

    KiuwanSummary.prototype.populateQaSummary = function (kiuwanJson) {
        var color = "";
        if (kiuwanJson["Quality indicator"] !== undefined) {
            var qaIndicator = parseFloat(kiuwanJson["Quality indicator"].value);

            if (qaIndicator < 25) color = "qa-l";
            else if (qaIndicator < 50) color = "qa-n";
            else if (qaIndicator < 75) color = "qa-h";
            else if (qaIndicator <= 100) color = "qa-vh";

            this._element.find("#qa-indicator-num").addClass(color);
            this._element.find("#qa-indicator-num").text(qaIndicator.toFixed(2));
        } else {
            this._element.find("#qa-empty").html("There is no QA indicator info to display from Kiuwan<br />");
            this._element.find("#qa-indicator").hide();
        }
    };

    return KiuwanSummary;
}(Controls.BaseControl));

KiuwanSummary.enhance(KiuwanSummary, $(".kiuwan-summary"), {});

// Notify the parent frame that the host has been loaded
VSS.notifyLoadSucceeded();
