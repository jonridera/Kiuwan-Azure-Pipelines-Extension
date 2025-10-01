const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

const sourceDir = path.join(__dirname, 'kiuwan-common');
const targets = [
    path.join(__dirname, 'baseline-analysis-task'),
    path.join(__dirname, 'delivery-analysis-task')
];

targets.forEach(targetDir => {
    console.log(`\nCopying ${sourceDir} → ${targetDir}`);
    
    // Copy the kiuwan-common folder into the task folder
    const destinationDir = path.join(targetDir, 'kiuwan-common');
    fs.copySync(sourceDir, destinationDir, { overwrite: true });
    console.log(`Copied ${sourceDir} to ${destinationDir}`);

    // Run npm install in the task folder
    console.log(`Running npm install in ${targetDir}...`);
    execSync('npm install', { cwd: targetDir, stdio: 'inherit' });
    console.log(`npm install completed in ${targetDir}`);
});
