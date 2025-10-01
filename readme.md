The Kiuwan extension for Azure DevOps and Azure DevOps Server includes 2 build tasks to run Kiuwan analyses as part of your application builds. In this latest version, we have added visual extensions to show results in the build's summary tab. We have also added specific Kiuwan tabs with more result details of baseline and delivery analyses, including links to see the full reports in Kiuwan directly from the build screens.

You can also define a Kiuwan service endpoint. This will allow you to store your Kiuwan credentials at the project level. At the same time, this service endpoint enables the extension to get information from your Kiuwan account to provide new exciting features and more to come.

If you want to install the existing, signed plugin, please download the extension from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=kiuwan-publisher.kiuwan-analysis-extension).

You can find more detailed information about installation and configuring the plugin our tech doc page: [Microsoft TFS Azure DevOps Extension](https://support.kiuwan.com/hc/en-us/articles/36335481452817-Microsoft-TFS-Azure-DevOps-Extension)

## What You Get With The Extension ##

By default, this open-source plugin provides the following: 

- **New Service Endpoint type.** This endpoint connects to the Kiuwan platform from Azure DevOps and Azure DevOps Server. It allows you to define a new service endpoint to the Kiuwan platform.

- **Kiuwan Baseline Analysis.** This task runs a Kiuwan baseline analysis as part of your build definition. The results are automatically uploaded to your Kiuwan account in the cloud where you can see the results and browse through the security vulnerabilities and other relevant defects found in your applications.

- **Kiuwan Delivery Analysis.** To use this task, you must have the Life Cycle module in your Kiuwan account. This task allows you to audit the deliveries of your application's change requests. The task runs a Kiuwan delivery analysis as part of your build definition. The results are automatically uploaded to your Kiuwan account and the defined audit is run comparing the results with the latest existing application baseline. The OK or Not OK (OK/NOK) audit result is what the task will return, failing or not failing your build definition execution.

## Customizing The Extension ##

This readme file covers the custom build scripts used for the extension and how the code is organized. For information on how to create new tasks and customizing extensions, please review [Microsoft's Documentation for Creating Pipeline Extensions](https://learn.microsoft.com/en-us/azure/devops/extend/develop/add-build-task?view=azure-devops).

When built into a VSIX file for use in Azure DevOps (or TFS), each task folder must contain all of its necessary code and cannot rely on extension-specific code outside of the task's directory.

**File Structure:** 
The source code and json files are contained in the root directory and subdirectories. Each task has its own task.json file, index.js, and package.json file required to build and run each task.

**kiuwan-common Directory:** 
The kiuwan-common directory contains code use by both tasks. Changes to files in this directory should be made with the intention of using the code for ALL tasks.

If you need to make changes any common code file, do so in the root `kiuwan-common` directory and then run the prepackage script.

**Prepackage Script:** 
The root package.json file contains a 'prepackage-script.js' file. You can execute this script with:
`npm run prepacakge`

You should run this before creating the vsix file.

This script will clone the `kiuwan-common` directory and files into the basline and delivery tasks, overwriting any files if they already exist.

This will also run `npm install` inside each task directory, ensuring each task's packages are installed.

**Package step** 
The 'package' script creates the UNSIGNED .vsix file, which can be installed for debugging or local use on Azure DevOps Server.

To create the vsix file, run:
`npm run package`