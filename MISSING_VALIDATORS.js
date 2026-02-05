// =====================================================
// MISSING VALIDATION FUNCTIONS FOR RESUME TAILORING
// =====================================================
// Add these functions to server.js (around line 1150, before performBrutalResumeValidation)

/**
 * MISSING VALIDATOR #1: JD Keyword Repetition Detection
 * Ensures resume doesn't obviously repeat JD keywords in consecutive bullets
 */
function detectJDKeywordRepetition(jobDescription, allBullets, jdSkills) {
  console.log('\n' + '='.repeat(80));
  console.log('🔍 VALIDATOR #1: JD KEYWORD REPETITION CHECK');
  console.log('-'.repeat(80));

  const requiredSkills = jdSkills.required || [];
  const repetitionIssues = [];
  const bulletJDKeywordCounts = [];

  // For each bullet, count how many JD keywords it contains
  allBullets.forEach((bullet, bulletIdx) => {
    const bulletLower = bullet.toLowerCase();
    let keywordCount = 0;
    const foundKeywords = [];

    requiredSkills.forEach(skill => {
      const skillLower = skill.toLowerCase();
      if (bulletLower.includes(skillLower)) {
        keywordCount++;
        foundKeywords.push(skill);
      }
    });

    bulletJDKeywordCounts.push({
      bulletIdx,
      keywordCount,
      keywords: foundKeywords,
      text: bullet.substring(0, 80)
    });
  });

  // Check 1: Consecutive high-keyword bullets
  console.log('\n📌 CHECK 1: Clustering Detection');
  let consecutiveCount = 0;
  let maxConsecutive = 0;

  for (let i = 0; i < bulletJDKeywordCounts.length; i++) {
    if (bulletJDKeywordCounts[i].keywordCount >= 2) {
      consecutiveCount++;
      maxConsecutive = Math.max(maxConsecutive, consecutiveCount);
    } else {
      consecutiveCount = 0;
    }
  }

  if (maxConsecutive >= 3) {
    repetitionIssues.push({
      type: 'CLUSTERING',
      severity: 'HIGH',
      message: `${maxConsecutive} consecutive bullets contain 2+ JD keywords - looks artificially optimized`,
      bulletIndices: bulletJDKeywordCounts
        .filter(b => b.keywordCount >= 2)
        .map(b => b.bulletIdx)
    });
    console.log(`   🔴 ISSUE: ${maxConsecutive} consecutive bullets with JD keywords`);
  } else {
    console.log(`   ✅ GOOD: Max ${maxConsecutive} consecutive high-keyword bullets (safe)`);
  }

  // Check 2: Individual keyword repetition
  console.log('\n📌 CHECK 2: Individual Keyword Over-mention');
  const keywordFrequency = {};

  allBullets.forEach(bullet => {
    requiredSkills.forEach(skill => {
      const skillLower = skill.toLowerCase();
      const bulletLower = bullet.toLowerCase();
      if (bulletLower.includes(skillLower)) {
        keywordFrequency[skill] = (keywordFrequency[skill] || 0) + 1;
      }
    });
  });

  Object.entries(keywordFrequency).forEach(([keyword, count]) => {
    if (count >= 5) {
      repetitionIssues.push({
        type: 'OVER_MENTION',
        severity: 'MEDIUM',
        keyword,
        count,
        message: `"${keyword}" mentioned ${count} times - suspicious over-repetition`
      });
      console.log(`   🟡 WARNING: "${keyword}" appears ${count} times`);
    } else if (count >= 4) {
      console.log(`   ⚠️ CAUTION: "${keyword}" appears ${count} times (monitor)`);
    }
  });

  if (Object.values(keywordFrequency).every(c => c < 5)) {
    console.log(`   ✅ GOOD: No keyword appears >4 times`);
  }

  // Check 3: Resume looks "customized" for this specific JD
  console.log('\n📌 CHECK 3: Over-Customization Risk');
  const totalBullets = allBullets.length;
  const bulletsWithJDKeywords = bulletJDKeywordCounts.filter(b => b.keywordCount >= 1).length;
  const bulletsCoverage = (bulletsWithJDKeywords / totalBullets) * 100;

  if (bulletsCoverage > 85) {
    repetitionIssues.push({
      type: 'OVER_CUSTOMIZATION',
      severity: 'HIGH',
      message: `${bulletsCoverage.toFixed(0)}% of bullets contain JD keywords - resume looks too tailored`,
      coverage: bulletsCoverage
    });
    console.log(`   🔴 CRITICAL: ${bulletsCoverage.toFixed(0)}% of bullets have JD keywords`);
    console.log(`      This resume looks obviously customized for this specific JD`);
  } else if (bulletsCoverage > 70) {
    console.log(`   🟡 WARNING: ${bulletsCoverage.toFixed(0)}% of bullets contain JD keywords`);
  } else {
    console.log(`   ✅ GOOD: Only ${bulletsCoverage.toFixed(0)}% of bullets explicitly mention JD keywords`);
  }

  const validator1Result = {
    passed: repetitionIssues.length === 0,
    issuesFound: repetitionIssues.length,
    issues: repetitionIssues,
    keywordFrequency,
    bulletsCoverage,
    recommendation: repetitionIssues.length > 0 
      ? '❌ Resume needs keyword distribution adjustments'
      : '✅ Resume shows natural skill distribution'
  };

  console.log(`\n📊 RESULT: ${validator1Result.passed ? '✅ PASS' : '❌ FAIL'} - ${validator1Result.issuesFound} issues found\n`);
  return validator1Result;
}

/**
 * MISSING VALIDATOR #2: Metrics Realism Detection
 * Ensures all metrics are within realistic bounds
 */
function validateMetricsRealism(allBullets) {
  console.log('='.repeat(80));
  console.log('🔍 VALIDATOR #2: METRICS REALISM CHECK');
  console.log('-'.repeat(80));

  const metricsIssues = [];
  const allMetrics = [];

  // Extract all numeric metrics from bullets
  const metricPatterns = [
    { regex: /(\d+)\s*%/g, type: 'percentage' },
    { regex: /(\d+\.?\d*)\s*[xX]\s*(improvement|faster|speedup)/g, type: 'multiplier' },
    { regex: /\$?(\d+[KMB]?)\s*(savings|saved|revenue)/g, type: 'monetary' },
    { regex: /(\d+)\s*(users|customers|transactions|requests)/g, type: 'volume' },
    { regex: /from\s*(\d+)\s*to\s*(\d+)/g, type: 'range' }
  ];

  allBullets.forEach((bullet, bulletIdx) => {
    metricPatterns.forEach(({ regex, type }) => {
      let match;
      while ((match = regex.exec(bullet)) !== null) {
        allMetrics.push({
          bulletIdx,
          type,
          text: match[0],
          values: match.slice(1),
          bullet: bullet.substring(0, 60)
        });
      }
    });
  });

  // Check 1: Unrealistic percentages
  console.log('\n📌 CHECK 1: Percentage Realism');
  const percentageMetrics = allMetrics.filter(m => m.type === 'percentage');

  percentageMetrics.forEach(metric => {
    const percent = parseInt(metric.values[0]);
    
    if (percent > 300) {
      metricsIssues.push({
        type: 'UNREALISTIC_PERCENTAGE',
        severity: 'CRITICAL',
        metric: `${percent}%`,
        message: `${percent}% improvement is impossible/suspicious (max realistic: ~100-200%)`
      });
      console.log(`   🔴 CRITICAL: "${metric.text}" - exceeds 300%`);
    } else if (percent > 200) {
      metricsIssues.push({
        type: 'SUSPICIOUS_PERCENTAGE',
        severity: 'HIGH',
        metric: `${percent}%`
      });
      console.log(`   🟡 WARNING: "${metric.text}" - unusually high (>200%)`);
    } else if (percent > 0 && percent <= 100) {
      console.log(`   ✅ GOOD: "${metric.text}" - realistic range`);
    }
  });

  if (percentageMetrics.length === 0) {
    console.log(`   ℹ️  No percentage metrics found`);
  }

  // Check 2: Multipliers without baseline
  console.log('\n📌 CHECK 2: Multiplier Metrics (Need Context)');
  const multiplierMetrics = allMetrics.filter(m => m.type === 'multiplier');

  multiplierMetrics.forEach(metric => {
    const multiplier = parseFloat(metric.values[0]);
    
    if (multiplier > 100) {
      metricsIssues.push({
        type: 'IMPLAUSIBLE_MULTIPLIER',
        severity: 'HIGH',
        metric: metric.text,
        message: `"${metric.text}" without baseline context is suspicious`
      });
      console.log(`   🔴 ISSUE: "${metric.text}" - implausible without baseline`);
    } else if (multiplier > 5) {
      console.log(`   ⚠️ CAUTION: "${metric.text}" - needs context in bullet`);
    } else {
      console.log(`   ✅ GOOD: "${metric.text}" - realistic`);
    }
  });

  if (multiplierMetrics.length === 0) {
    console.log(`   ℹ️  No multiplier metrics found`);
  }

  // Check 3: Metric support (is it explained?)
  console.log('\n📌 CHECK 3: Metric Support in Bullet');
  allMetrics.forEach(metric => {
    const bullet = allBullets[metric.bulletIdx];
    const hasExplanation = /implemented|developed|built|created|designed|engineered|reduced|improved|increased|optimized/i.test(bullet);
    
    if (!hasExplanation) {
      metricsIssues.push({
        type: 'UNSUPPORTED_METRIC',
        severity: 'MEDIUM',
        metric: metric.text,
        message: `Metric not supported by action verb - looks forced`
      });
      console.log(`   ⚠️ WARNING: "${metric.text}" - lacks supporting action verb`);
    }
  });

  // Check 4: Too many metrics in short time
  console.log('\n📌 CHECK 4: Metric Density');
  const totalMetrics = allMetrics.length;
  const totalBullets = allBullets.length;
  const metricsPerBullet = totalBullets > 0 ? totalMetrics / totalBullets : 0;

  console.log(`   Total metrics: ${totalMetrics} across ${totalBullets} bullets (${metricsPerBullet.toFixed(2)} per bullet)`);
  
  if (metricsPerBullet > 1.5) {
    metricsIssues.push({
      type: 'METRIC_STUFFING',
      severity: 'MEDIUM',
      density: metricsPerBullet,
      message: `Too many metrics per bullet (${metricsPerBullet.toFixed(2)}) - looks forced`
    });
    console.log(`   🟡 WARNING: High metric density - might look over-optimized`);
  } else if (metricsPerBullet < 0.3) {
    console.log(`   ⚠️ NOTE: Low metric density (${metricsPerBullet.toFixed(2)}) - could add more`);
  } else {
    console.log(`   ✅ GOOD: Healthy metric density`);
  }

  const validator2Result = {
    passed: !metricsIssues.some(i => i.severity === 'CRITICAL' || i.severity === 'HIGH'),
    issuesFound: metricsIssues.length,
    issues: metricsIssues,
    metricsFound: allMetrics.length,
    recommendation: metricsIssues.length === 0
      ? '✅ Metrics are realistic and well-supported'
      : '⚠️ Fix unrealistic or unsupported metrics'
  };

  console.log(`\n📊 RESULT: ${validator2Result.passed ? '✅ PASS' : '❌ FAIL'} - ${validator2Result.issuesFound} issues found\n`);
  return validator2Result;
}

/**
 * MISSING VALIDATOR #3: Skill Distribution Analysis
 * Ensures JD skills are spread naturally across multiple jobs
 */
function validateSkillDistribution(allBullets, requiredSkills, experiences) {
  console.log('='.repeat(80));
  console.log('🔍 VALIDATOR #3: SKILL DISTRIBUTION CHECK');
  console.log('-'.repeat(80));

  const distributionIssues = [];

  // Map bullets to experiences (simple: assumes bullets grouped by company)
  // In real implementation, parse resume structure more carefully
  const bulletsByExperience = {};
  let currentExperience = 'Job 1';
  let jobCounter = 0;

  allBullets.forEach((bullet, idx) => {
    if (idx % 8 === 0 && idx > 0) jobCounter++;
    currentExperience = `Job ${jobCounter + 1}`;
    if (!bulletsByExperience[currentExperience]) {
      bulletsByExperience[currentExperience] = [];
    }
    bulletsByExperience[currentExperience].push(bullet);
  });

  // For each required skill, track where it appears
  console.log('\n📌 CHECK 1: Skill Spread Across Experiences');
  const skillDistribution = {};

  requiredSkills.forEach(skill => {
    skillDistribution[skill] = {};
    
    Object.entries(bulletsByExperience).forEach(([expName, bullets]) => {
      const count = bullets.filter(b => b.toLowerCase().includes(skill.toLowerCase())).length;
      if (count > 0) {
        skillDistribution[skill][expName] = count;
      }
    });
  });

  // Check for clustering (all mentions in 1-2 jobs)
  Object.entries(skillDistribution).forEach(([skill, distribution]) => {
    const jobsWithSkill = Object.keys(distribution).length;
    const totalMentions = Object.values(distribution).reduce((a, b) => a + b, 0);

    if (jobsWithSkill === 1 && totalMentions >= 3) {
      distributionIssues.push({
        type: 'SKILL_CLUSTERING',
        severity: 'MEDIUM',
        skill,
        message: `"${skill}" appears only in 1 job (${totalMentions}x) - might look focused on one role`,
        concentration: 100
      });
      console.log(`   🟡 WARNING: "${skill}" appears only in ${Object.keys(distribution)[0]} (${totalMentions}x)`);
    } else if (jobsWithSkill >= 2) {
      console.log(`   ✅ GOOD: "${skill}" spread across ${jobsWithSkill} experiences`);
    }
  });

  // Check 2: All skills only in recent job (looks like JD tailoring)
  console.log('\n📌 CHECK 2: Chronological Distribution');
  const jobs = Object.keys(bulletsByExperience);
  let recentJobSkillCount = 0;
  let recentJobTotal = bulletsByExperience[jobs[0]]?.length || 0;

  requiredSkills.forEach(skill => {
    if (skillDistribution[skill][jobs[0]]) {
      recentJobSkillCount++;
    }
  });

  const recentJobSkillPercent = requiredSkills.length > 0 
    ? (recentJobSkillCount / requiredSkills.length) * 100 
    : 0;

  if (recentJobSkillPercent > 70) {
    distributionIssues.push({
      type: 'RECENT_JOB_BIAS',
      severity: 'HIGH',
      message: `${recentJobSkillPercent.toFixed(0)}% of JD skills appear only in most recent job - looks tailored`,
      percentage: recentJobSkillPercent
    });
    console.log(`   🔴 ISSUE: ${recentJobSkillPercent.toFixed(0)}% of JD skills in most recent job only`);
  } else {
    console.log(`   ✅ GOOD: JD skills distributed across multiple time periods`);
  }

  // Check 3: Natural progression (older roles have foundational skills, newer have advanced)
  console.log('\n📌 CHECK 3: Natural Skill Progression');
  const skillMentionsByExperience = {};
  
  jobs.forEach((job, idx) => {
    skillMentionsByExperience[job] = requiredSkills.filter(
      skill => skillDistribution[skill][job]
    ).length;
  });

  // Expect: older jobs have fewer specialized mentions, newer jobs have more
  const progression = Object.values(skillMentionsByExperience);
  let naturalProgression = true;

  if (progression.length > 1) {
    // Check if it's reasonably monotonic
    for (let i = 1; i < progression.length; i++) {
      if (progression[i] > progression[i - 1] + 2) {
        naturalProgression = false;
        break;
      }
    }

    if (naturalProgression) {
      console.log(`   ✅ GOOD: Skill mentions show natural progression`);
    } else {
      distributionIssues.push({
        type: 'UNNATURAL_PROGRESSION',
        severity: 'LOW',
        message: 'Skill mentions increase too sharply - might look artificially focused on JD'
      });
      console.log(`   ⚠️ CAUTION: Sharp increase in specialized skills in recent role`);
    }
  }

  const validator3Result = {
    passed: !distributionIssues.some(i => i.severity === 'HIGH'),
    issuesFound: distributionIssues.length,
    issues: distributionIssues,
    skillDistribution,
    recommendation: distributionIssues.length === 0
      ? '✅ Skills naturally distributed'
      : '⚠️ Rebalance skill distribution to look less tailored'
  };

  console.log(`\n📊 RESULT: ${validator3Result.passed ? '✅ PASS' : '❌ NEEDS REVIEW'} - ${validator3Result.issuesFound} issues\n`);
  return validator3Result;
}

/**
 * MISSING VALIDATOR #4: Company-Specific Language Detection
 * Ensures resume isn't over-tailored to one company
 */
function detectCompanySpecificLanguage(resumeJson, allBullets) {
  console.log('='.repeat(80));
  console.log('🔍 VALIDATOR #4: OVER-TAILORING LANGUAGE CHECK');
  console.log('-'.repeat(80));

  const tailorIssues = [];

  // Common overly-specific patterns
  const redFlagPatterns = [
    // Proprietary tool names (should be "banking platform" not "SAP Fiori")
    { pattern: /\b(Salesforce|ServiceNow|SAP|Oracle|Workday|ADP|Concur)\b/gi, type: 'ENTERPRISE_TOOL', risk: 'HIGH' },
    // Company-specific methodologies
    { pattern: /\b(Spotify Model|Spotify Squad|Facebook Groups|Google OKRs)\b/gi, type: 'METHODOLOGY', risk: 'MEDIUM' },
    // Overly specific frameworks
    { pattern: /proprietary|internal|bespoke|custom-built|in-house/gi, type: 'SPECIFICITY', risk: 'MEDIUM' },
    // Bank-specific (if resume should be general)
    { pattern: /banking|fintech|payments|lending/gi, type: 'DOMAIN', risk: 'LOW' }
  ];

  const summary = (resumeJson.SUMMARY || '').toLowerCase();
  const bulletsText = allBullets.join(' ').toLowerCase();
  const fullText = summary + ' ' + bulletsText;

  let mentionCount = 0;

  redFlagPatterns.forEach(({ pattern, type, risk }) => {
    const matches = fullText.match(pattern) || [];
    
    if (matches.length > 0) {
      tailorIssues.push({
        type,
        risk,
        matches: matches.length,
        examples: [...new Set(matches)].slice(0, 3)
      });
      
      if (risk === 'HIGH') {
        console.log(`   🔴 WARNING: Proprietary tool mentioned: ${matches[0]}`);
      } else if (risk === 'MEDIUM') {
        console.log(`   🟡 CAUTION: Specific language: ${matches[0]}`);
      }
      mentionCount += matches.length;
    }
  });

  if (mentionCount === 0) {
    console.log(`   ✅ GOOD: No proprietary tool/company-specific language detected`);
  }

  const validator4Result = {
    passed: !tailorIssues.some(i => i.risk === 'HIGH'),
    issuesFound: tailorIssues.length,
    issues: tailorIssues,
    recommendation: tailorIssues.length === 0
      ? '✅ Resume is company-agnostic'
      : '⚠️ Replace proprietary tools with generic descriptions'
  };

  console.log(`\n📊 RESULT: ${validator4Result.passed ? '✅ PASS' : '⚠️ REVIEW'}\n`);
  return validator4Result;
}

/**
 * MISSING VALIDATOR #5: Weak Skill Relevance
 * Filters out skills that don't actually relate to the JD
 */
function detectWeakSkillRelevance(allBullets, resumeSkills, jobDescription, requiredSkills) {
  console.log('='.repeat(80));
  console.log('🔍 VALIDATOR #5: WEAK SKILL RELEVANCE CHECK');
  console.log('-'.repeat(80));

  const weakSkills = [];
  const jdLower = jobDescription.toLowerCase();

  resumeSkills.forEach(skill => {
    const skillLower = skill.toLowerCase();
    
    // Check 1: Is skill in JD?
    const inJD = jdLower.includes(skillLower);
    
    // Check 2: How many times does it appear in resume vs JD?
    const resumeMentions = allBullets.filter(b => b.toLowerCase().includes(skillLower)).length;
    const jdMentions = (jobDescription.match(new RegExp(skillLower, 'g')) || []).length;
    
    // Check 3: Is it a primary requirement or afterthought?
    const isPrimary = requiredSkills.some(s => s.toLowerCase() === skillLower);
    
    // Weakness scoring
    let weaknessScore = 0;
    if (!inJD) weaknessScore += 50;                    // Not in JD = weak
    if (resumeMentions === 1) weaknessScore += 20;    // Only mentioned once = weak
    if (jdMentions === 1) weaknessScore += 15;        // Rare in JD = weak
    if (!isPrimary) weaknessScore += 10;              // Not required = weak

    if (weaknessScore >= 60) {
      weakSkills.push({
        skill,
        weaknessScore,
        inJD,
        resumeMentions,
        jdMentions,
        isPrimary,
        recommendation: 'REMOVE - Not relevant to this role'
      });
    }
  });

  if (weakSkills.length > 0) {
    console.log(`\n📌 WEAK SKILLS DETECTED (relevance < 40%):`);
    weakSkills.forEach(ws => {
      console.log(`   ⚠️ "${ws.skill}" - Weakness score: ${ws.weaknessScore}/100`);
      console.log(`      • In JD: ${ws.inJD ? 'YES' : 'NO'} | Resume mentions: ${ws.resumeMentions} | JD mentions: ${ws.jdMentions}`);
    });
  } else {
    console.log(`\n   ✅ GOOD: All resume skills are relevant to the JD`);
  }

  const validator5Result = {
    passed: weakSkills.length === 0,
    weakSkillsFound: weakSkills.length,
    skills: weakSkills,
    recommendation: weakSkills.length === 0
      ? '✅ Resume skills well-aligned with JD'
      : `⚠️ Remove ${weakSkills.length} weak/irrelevant skills`
  };

  console.log(`\n📊 RESULT: ${validator5Result.passed ? '✅ PASS' : '⚠️ REVIEW'}\n`);
  return validator5Result;
}

// =====================================================
// MASTER VALIDATOR ORCHESTRATION
// =====================================================

/**
 * COMPREHENSIVE: Run all validators and provide holistic "No Tailoring Signals" score
 */
async function validateNoTailoringSignals({ jobDescription, resumeJson, allBullets, requiredSkills, preferredSkills }) {
  console.log('\n\n' + '█'.repeat(80));
  console.log('█' + ' '.repeat(78) + '█');
  console.log('█' + ' '.repeat(20) + 'COMPREHENSIVE NO-TAILORING VALIDATION' + ' '.repeat(22) + '█');
  console.log('█' + ' '.repeat(78) + '█');
  console.log('█'.repeat(80) + '\n');

  const allValidators = [];

  // Run all 5 validators
  const jdSkills = { required: requiredSkills, preferred: preferredSkills };
  
  allValidators.push(detectJDKeywordRepetition(jobDescription, allBullets, jdSkills));
  allValidators.push(validateMetricsRealism(allBullets));
  allValidators.push(validateSkillDistribution(allBullets, requiredSkills, {}));
  allValidators.push(detectCompanySpecificLanguage(resumeJson, allBullets));
  allValidators.push(detectWeakSkillRelevance(allBullets, resumeJson.SKILLS || [], jobDescription, requiredSkills));

  // Aggregate results
  console.log('\n' + '='.repeat(80));
  console.log('📊 VALIDATOR SUMMARY DASHBOARD');
  console.log('='.repeat(80) + '\n');

  const validatorNames = [
    '1. JD Keyword Repetition',
    '2. Metrics Realism',
    '3. Skill Distribution',
    '4. Company-Specific Language',
    '5. Weak Skill Relevance'
  ];

  let totalPass = 0;
  let totalIssues = 0;

  allValidators.forEach((result, idx) => {
    const status = result.passed ? '✅ PASS' : '⚠️ NEEDS REVIEW';
    console.log(`${validatorNames[idx]}: ${status} (${result.issuesFound || 0} issues)`);
    if (result.passed) totalPass++;
    totalIssues += result.issuesFound || 0;
  });

  // Final score
  const tailoringScore = (totalPass / allValidators.length) * 100;
  const tailoringRisk = tailoringScore >= 80 ? 'LOW 🟢' : tailoringScore >= 60 ? 'MEDIUM 🟡' : 'HIGH 🔴';

  console.log('\n' + '='.repeat(80));
  console.log(`🎯 FINAL TAILORING RISK: ${tailoringRisk}`);
  console.log(`📊 Validators Passed: ${totalPass}/${allValidators.length}`);
  console.log(`⚠️  Total Issues Found: ${totalIssues}`);
  console.log('='.repeat(80) + '\n');

  // Reusability check
  if (tailoringScore >= 75) {
    console.log('✅ VERDICT: Resume works for multiple similar positions');
    console.log('   This resume should be safe to submit to similar roles\n');
  } else if (tailoringScore >= 50) {
    console.log('⚠️ VERDICT: Resume has some customization - adjust before reuse');
    console.log('   Make small changes before applying to other companies\n');
  } else {
    console.log('🔴 VERDICT: Resume looks obviously tailored - will not work elsewhere');
    console.log('   Requires significant revision for other applications\n');
  }

  return {
    tailoringScore: Math.round(tailoringScore),
    tailoringRisk,
    validatorsResult: allValidators,
    passed: tailoringScore >= 75,
    recommendations: allValidators
      .flatMap(v => v.issues || [])
      .filter((issue, idx, arr) => arr.indexOf(issue) === idx)
  };
}

module.exports = {
  detectJDKeywordRepetition,
  validateMetricsRealism,
  validateSkillDistribution,
  detectCompanySpecificLanguage,
  detectWeakSkillRelevance,
  validateNoTailoringSignals
};
