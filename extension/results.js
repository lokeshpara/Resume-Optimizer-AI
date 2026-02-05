// Results page JavaScript
console.log('Results page loaded');

// Load data from chrome.storage
chrome.storage.local.get(['analysisResults', 'optimizationResults', 'tailoringAnalysis'], function (result) {
    console.log('Storage result:', result);

    // Check if we have analysis results (from analyze) or optimization results (from optimize)
    const data = result.analysisResults || result.optimizationResults;
    
    if (data) {
        console.log('Analysis data loaded:', data);
        console.log('Company:', data.companyName);
        console.log('Scores:', data.scores);
        console.log('Summary:', data.summary);
        console.log('Tailoring Analysis:', data.tailoringAnalysis || result.tailoringAnalysis);

        try {
            displayResults(data);
            console.log('Results displayed successfully');
        } catch (error) {
            console.error('Error displaying results:', error);
            document.getElementById('recommendation').textContent = 'Error displaying results: ' + error.message;
        }

        // Clear the storage after loading
        chrome.storage.local.remove(['analysisResults', 'optimizationResults', 'tailoringAnalysis']);
    } else {
        console.error('No analysis results found in storage');
        console.log('Available storage keys:', Object.keys(result));
        document.getElementById('recommendation').textContent = 'No analysis data found. Please run analysis again.';
    }
});

function displayResults(data) {
    console.log('displayResults called with:', data);

    // Company name
    const companyEl = document.getElementById('companyName');
    if (companyEl) {
        companyEl.textContent = data.companyName || 'Company Analysis';
        console.log('Company name set:', data.companyName);
    }

    // Scores
    if (data.scores) {
        displayScore(1, data.scores.resumeJDMatch);
        displayScore(2, data.scores.experienceRoleFit);
        displayScore(3, data.scores.postOptimizationPotential);
        displayScore(4, data.scores.selectionProbability);
        console.log('Scores displayed');
    } else {
        console.error('No scores in data');
    }

    // Summary
    if (data.summary) {
        const avgEl = document.getElementById('avgScore');
        const recEl = document.getElementById('recommendation');

        if (avgEl) {
            avgEl.textContent = data.summary.averageScore + '%';
            console.log('Average score set:', data.summary.averageScore);
        }

        if (recEl) {
            recEl.textContent = data.summary.recommendation;
            console.log('Recommendation set');
        }

        // Strengths
        const strengthsList = document.getElementById('strengthsList');
        if (strengthsList && data.summary.strengths) {
            strengthsList.innerHTML = '';
            data.summary.strengths.forEach(strength => {
                const li = document.createElement('li');
                li.textContent = strength;
                strengthsList.appendChild(li);
            });
            console.log('Strengths displayed:', data.summary.strengths.length);
        }

        // Improvements
        const improvementsList = document.getElementById('improvementsList');
        if (improvementsList && data.summary.improvements) {
            improvementsList.innerHTML = '';
            data.summary.improvements.forEach(improvement => {
                const li = document.createElement('li');
                li.textContent = improvement;
                improvementsList.appendChild(li);
            });
            console.log('Improvements displayed:', data.summary.improvements.length);
        }
    } else {
        console.error('No summary in data');
    }

    // Detailed reports
    if (data.detailedReports) {
        const report1 = document.getElementById('report1');
        const report2 = document.getElementById('report2');
        const report3 = document.getElementById('report3');
        const report4 = document.getElementById('report4');

        if (report1) report1.textContent = data.detailedReports.resumeJDMatch || 'No data';
        if (report2) report2.textContent = data.detailedReports.experienceRoleFit || 'No data';
        if (report3) report3.textContent = data.detailedReports.postOptimizationPotential || 'No data';
        if (report4) report4.textContent = data.detailedReports.selectionProbability || 'No data';
        console.log('Reports displayed');
    } else {
        console.error('No detailed reports in data');
    }

    // Tailoring analysis
    if (data.tailoringAnalysis) {
        displayTailoringAnalysis(data.tailoringAnalysis);
        console.log('Tailoring analysis displayed');
    } else {
        console.log('No tailoring analysis in data');
    }
}

function displayScore(num, score) {
    const scoreElem = document.getElementById('score' + num);
    const indicatorElem = document.getElementById('indicator' + num);

    if (!scoreElem || !indicatorElem) {
        console.error('Score elements not found for score ' + num);
        return;
    }

    scoreElem.textContent = score + '%';

    let colorClass, indicator;
    if (score >= 80) {
        colorClass = 'excellent';
        indicator = '🟢';
    } else if (score >= 60) {
        colorClass = 'good';
        indicator = '🟡';
    } else if (score >= 40) {
        colorClass = 'moderate';
        indicator = '🟠';
    } else {
        colorClass = 'low';
        indicator = '🔴';
    }

    scoreElem.className = 'score ' + colorClass;
    indicatorElem.textContent = indicator;
}

function optimizeNow() {
    alert('Opening extension to optimize resume...');
    window.close();
}

function downloadReport() {
    alert('PDF download feature coming soon!');
}

// =====================================================
// DISPLAY TAILORING ANALYSIS
// =====================================================

function displayTailoringAnalysis(tailoringData) {
    if (!tailoringData) return;

    // Display tailoring score
    const scoreEl = document.getElementById('tailoringScore');
    if (scoreEl) {
        scoreEl.textContent = tailoringData.tailoringScore + '%';
    }

    // Display tailoring risk with color
    const riskEl = document.getElementById('tailoringRisk');
    if (riskEl) {
        riskEl.textContent = tailoringData.tailoringRisk;
        
        // Set risk color class
        riskEl.className = 'tailoring-risk';
        if (tailoringData.tailoringRisk.includes('LOW')) {
            riskEl.classList.add('low');
        } else if (tailoringData.tailoringRisk.includes('MEDIUM')) {
            riskEl.classList.add('medium');
        } else {
            riskEl.classList.add('high');
        }
    }

    // Display validators
    const validatorsList = document.getElementById('validatorsList');
    if (validatorsList) {
        validatorsList.innerHTML = '';
        
        const validatorNames = [
            'JD Keyword Repetition',
            'Metrics Realism',
            'Skill Distribution',
            'Company-Specific Language',
            'Weak Skill Relevance'
        ];

        if (tailoringData.validatorsPassed) {
            const parts = tailoringData.validatorsPassed.split('/');
            const passed = parseInt(parts[0]);
            const total = parseInt(parts[1]);

            for (let i = 0; i < total; i++) {
                const isPassed = i < passed;
                const icon = isPassed ? '✅' : '⚠️';
                const status = isPassed ? 'passed' : 'failed';
                
                const div = document.createElement('div');
                div.className = `validator-item ${status}`;
                div.innerHTML = `<span>${icon} ${validatorNames[i] || 'Validator ' + (i+1)}</span>`;
                validatorsList.appendChild(div);
            }
        }
    }

    // Display verdict
    const verdictEl = document.getElementById('tailoringVerdict');
    if (verdictEl) {
        const score = tailoringData.tailoringScore;
        if (score >= 75) {
            verdictEl.textContent = '✅ Resume works for multiple similar positions. This resume should be safe to submit to similar roles.';
        } else if (score >= 50) {
            verdictEl.textContent = '⚠️ Resume has some customization. Make small adjustments before applying to other companies.';
        } else {
            verdictEl.textContent = '🔴 Resume looks obviously tailored. Requires significant revision for other applications.';
        }
    }

    // Display recommendations
    const recList = document.getElementById('tailoringRecommendations');
    if (recList) {
        recList.innerHTML = '';
        
        if (tailoringData.recommendations && tailoringData.recommendations.length > 0) {
            tailoringData.recommendations.forEach(rec => {
                const li = document.createElement('li');
                li.textContent = typeof rec === 'string' ? rec : (rec.message || JSON.stringify(rec));
                recList.appendChild(li);
            });
        } else {
            const li = document.createElement('li');
            li.textContent = 'No specific recommendations at this time.';
            recList.appendChild(li);
        }
    }
}