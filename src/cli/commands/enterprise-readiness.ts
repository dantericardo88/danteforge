import { Command } from 'commander';
import { generateEnterpriseReadinessReport, EnterpriseComplianceOptions } from '../core/enterprise-readiness.js';
import { validateSecurityControls } from '../core/security-controls.js';
import { generateComplianceReport } from '../core/compliance-engine.js';
import { logger } from '../core/logger.js';

export async function enterpriseReadiness(options: EnterpriseComplianceOptions = {}) {
  try {
    logger.info('Generating enterprise readiness assessment...');

    // Generate main enterprise report
    const report = await generateEnterpriseReadinessReport(options);

    // Run security validation
    const securityResults = await validateSecurityControls({
      checkSecrets: true,
      checkPermissions: true,
      checkIntegrity: true
    });

    // Generate compliance report
    const complianceReport = await generateComplianceReport();

    // Combine results
    const combinedReport = {
      ...report,
      securityValidation: securityResults,
      complianceReport
    };

    // Output based on format
    if (options.format === 'json') {
      console.log(JSON.stringify(combinedReport, null, 2));
    } else if (options.format === 'markdown') {
      console.log(generateMarkdownReport(combinedReport));
    } else {
      console.log(`Enterprise Readiness Score: ${combinedReport.enterpriseReadinessScore}/10`);
      console.log(`Features Implemented: ${combinedReport.featuresImplemented}/${combinedReport.totalFeatures}`);
      console.log(`Security Issues: ${securityResults.issues.length}`);
    }

  } catch (error) {
    logger.error('Enterprise readiness assessment failed:', error);
    process.exit(1);
  }
}

function generateMarkdownReport(report: any): string {
  let md = `# Enterprise Readiness Report\n\n`;
  md += `**Score:** ${report.enterpriseReadinessScore}/10\n`;
  md += `**Features:** ${report.featuresImplemented}/${report.totalFeatures}\n`;
  md += `**Security Issues:** ${report.securityValidation.issues.length}\n\n`;

  if (report.securityValidation.issues.length > 0) {
    md += `## Security Issues\n\n`;
    for (const issue of report.securityValidation.issues) {
      md += `- ${issue}\n`;
    }
    md += '\n';
  }

  md += `## Compliance Report\n\n`;
  md += report.complianceReport;

  return md;
}