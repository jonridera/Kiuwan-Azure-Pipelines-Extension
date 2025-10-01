var Controls = require("VSS/Controls");
// var VSS_Service = require("VSS/Service");
var TFS_Build_Contracts = require("TFS/Build/Contracts");
var TFS_Build_Extension_Contracts = require("TFS/Build/ExtensionContracts");
var DT_Client = require("TFS/DistributedTask/TaskRestClient");

var KiuwanTab = /** @class */ (function (_super) {
    __extends(KiuwanTab, _super);

    function KiuwanTab() {
        return _super.call(this) || this;
    }

    KiuwanTab.prototype.initialize = function () {
        var _this = this;
        _super.prototype.initialize.call(this);

        var sharedConfig = VSS.getConfiguration();
        var vsoContext = VSS.getWebContext();

        if (sharedConfig) {
            sharedConfig.onBuildChanged(function (build) {
                _this._initBuildInfo(build);

                var taskClient = DT_Client.getClient();

                taskClient.getPlanAttachments(vsoContext.project.id, "build", build.orchestrationPlan.planId, "Kiuwantask.Baseline.Results")
                    .then(function (taskAttachments) {
                        if (taskAttachments.length == 0) {
                            _this._element.find("#disclaimer").show();
                        } else {
                            _this._element.find("#kiuwan-info-tab").show();
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
                                _this.populateSecurityInfo(kiuwanJson);
                                _this.populateDefectsInfo(kiuwanJson);
                                _this.populateRiskInfo(kiuwanJson);
                                _this.populateQaInfo(kiuwanJson);
                                _this.populateEffortInfo(kiuwanJson);
                                _this.populateQaDisttInfo(kiuwanJson);
                            });
                        });
                    });
            });
        }
    };

    KiuwanTab.prototype._initBuildInfo = function (build) { };

    KiuwanTab.prototype.setKiuwanResultsLink = function (url) {
        this._element.find("#kiuwan-link").attr("href", url);
    };

    KiuwanTab.prototype.populateSecurityInfo = function (kiuwanJson) {
        if (kiuwanJson.Security !== undefined) {
            var totalVulns = kiuwanJson.Security.Vulnerabilities.Total.toFixed(0);
            var totalLoc = kiuwanJson["Main metrics"][5].value.toFixed(0);

            this._element.find("#sec-vulns-num").text(totalVulns);
            this._element.find("#sec-loc-num").text(totalLoc);

            var starYes = '<img src="images/star-yes.png" />';
            var secRating = kiuwanJson.Security.Rating;
            for (var i = 1; i <= secRating; i++) {
                this._element.find("#sec-star-" + i).html(starYes);
            }

            this._element.find("#vh-vulns-num").text(kiuwanJson.Security.Vulnerabilities.VeryHigh.toFixed(0));
            this._element.find("#h-vulns-num").text(kiuwanJson.Security.Vulnerabilities.High.toFixed(0));
            this._element.find("#n-vulns-num").text(kiuwanJson.Security.Vulnerabilities.Normal.toFixed(0));
            this._element.find("#l-vulns-num").text(kiuwanJson.Security.Vulnerabilities.Low.toFixed(0));
        } else {
            this._element.find("#sec-empty").html("There is no security info to display from Kiuwan<br />");
            this._element.find("#sec-summary").hide();
        }
    };

    KiuwanTab.prototype.populateDefectsInfo = function (kiuwanJson) {
        this._element.find("#qa-defects-num").text(kiuwanJson["Main metrics"][1].value.toFixed(0));
        this._element.find("#qa-loc-num").text(kiuwanJson["Main metrics"][5].value.toFixed(0));
    };

    KiuwanTab.prototype.populateRiskInfo = function (kiuwanJson) {
        var color = "";
        if (kiuwanJson["Risk index"] !== undefined) {
            var risk = parseFloat(kiuwanJson["Risk index"].value);
            if (risk < 25) color = "risk-l";
            else if (risk < 50) color = "risk-n";
            else if (risk < 75) color = "risk-h";
            else if (risk <= 100) color = "risk-vh";

            this._element.find("#qa-risk-num").addClass(color);
            this._element.find("#qa-risk-num").text(risk.toFixed(2));
        } else {
            this._element.find("#risk-empty").html("There is no QA risk info to display from Kiuwan<br />");
            this._element.find("#qa-risk").hide();
        }
    };

    KiuwanTab.prototype.populateQaInfo = function (kiuwanJson) {
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
            this._element.find("#qa-qa-indicator").hide();
        }
    };

    KiuwanTab.prototype.populateEffortInfo = function (kiuwanJson) {
        if (kiuwanJson["Effort to target"] !== undefined) {
            this._element.find("#qa-effort-num").text(kiuwanJson["Effort to target"].value.toFixed(2));
        } else {
            this._element.find("#effort-empty").html("There is no Eefort to target info to display from Kiuwan<br />");
            this._element.find("#qa-effort-target").hide();
        }
    };

    KiuwanTab.prototype.populateQaDisttInfo = function (kiuwanJson) {
        if (kiuwanJson["Quality indicator"] !== undefined) {
            var children = kiuwanJson["Quality indicator"].children;
            this._element.find("#efficiency-num").text(children[0].value.toFixed(2));
            this._element.find("#maintainabilty-num").text(children[1].value.toFixed(2));
            this._element.find("#portability-num").text(children[2].value.toFixed(2));
            this._element.find("#reliability-num").text(children[3].value.toFixed(2));
            this._element.find("#security-num").text(children[4].value.toFixed(2));
        } else {
            this._element.find("#qa-dist").hide();
        }
    };

    return KiuwanTab;
}(Controls.BaseControl));

KiuwanTab.enhance(KiuwanTab, $(".kiuwan-info"), {});

// Notify the parent frame that the host has been loaded
VSS.notifyLoadSucceeded();
