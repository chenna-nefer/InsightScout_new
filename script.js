document.addEventListener('DOMContentLoaded', function() {
    // API Configuration
    const API_BASE_URL = 'https://insightscout.onrender.com';
    
    // DOM Elements
    const fileInput = document.getElementById('file-input');
    const startResearchBtn = document.getElementById('start-research');
    const cancelResearchBtn = document.getElementById('cancel-research');
    const downloadResultsBtn = document.getElementById('download-results');
    const startNewBtn = document.getElementById('start-new');
    const progressSection = document.getElementById('progress-section');
    const resultsSection = document.getElementById('results-section');
    const inputSection = document.querySelector('.input-section');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const currentCompanySpan = document.getElementById('current-company');
    const resultsBody = document.getElementById('results-body');
    const totalCompaniesSpan = document.getElementById('total-companies');
    const totalFoundersSpan = document.getElementById('total-founders');
    const totalLinkedinSpan = document.getElementById('total-linkedin');
    const textarea = document.querySelector('textarea');

    // Store results and job ID
    let currentResults = [];
    let currentJobId = null;

    // File Upload Handling
    fileInput.addEventListener('change', handleFileUpload);
    
    // Drag and Drop
    const fileUploadArea = document.querySelector('.file-upload');
    fileUploadArea.addEventListener('dragover', handleDragOver);
    fileUploadArea.addEventListener('drop', handleFileDrop);

    // Button Click Handlers
    startResearchBtn.addEventListener('click', startResearch);
    cancelResearchBtn.addEventListener('click', cancelResearch);
    downloadResultsBtn.addEventListener('click', downloadResults);
    startNewBtn.addEventListener('click', startNew);

    // File Upload Functions
    function handleFileUpload(e) {
        const file = e.target.files[0];
        if (file) {
            validateAndProcessFile(file);
        }
    }

    function handleDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        this.style.borderColor = getComputedStyle(document.documentElement).getPropertyValue('--primary-color');
    }

    function handleFileDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        this.style.borderColor = getComputedStyle(document.documentElement).getPropertyValue('--secondary-color');
        
        const file = e.dataTransfer.files[0];
        if (file) {
            validateAndProcessFile(file);
        }
    }

    function validateAndProcessFile(file) {
        const validExtensions = ['.xlsx', '.csv'];
        const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
        
        if (validExtensions.includes(fileExtension)) {
            startResearch(file);
        } else {
            alert('Please upload an Excel (.xlsx) or CSV (.csv) file');
        }
    }

    // Research Process Functions
    async function startResearch(file) {
        try {
            // Reset results but keep sections visible
            currentResults = [];
            resultsBody.innerHTML = '';
            
            // Show progress and results sections, hide input
            inputSection.style.display = 'none';
            progressSection.style.display = 'block';
            resultsSection.style.display = 'block';
            
            // Reset progress bar
            progressBarFill.style.width = '0%';
            progressBarFill.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--secondary-color');
            currentCompanySpan.textContent = 'Starting research...';
            
            const formData = new FormData();
            formData.append('file', file);

            console.log('Starting research with file:', file.name);
            const response = await fetch(`${API_BASE_URL}/api/research/upload`, {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to start research');
            }

            console.log('Server response:', data);
            
            if (!data.jobId) {
                throw new Error('No job ID received from server');
            }

            if (!data.companies || !Array.isArray(data.companies) || data.companies.length === 0) {
                throw new Error('No valid companies found in file');
            }

            currentJobId = data.jobId;
            
            // Update table structure to include all columns
            const headerRow = document.querySelector('thead tr');
            headerRow.innerHTML = `
                <th>Company</th>
                <th>Founder</th>
                <th>LinkedIn</th>
                <th>Email</th>
                <th>Phone</th>
            `;
            
            // Pre-populate table with company names
            console.log('Creating table with companies:', data.companies);
            data.companies.forEach(companyName => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${companyName}</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                `;
                resultsBody.appendChild(row);
            });

            // Update summary with total companies
            totalCompaniesSpan.textContent = data.companies.length;
            
            // Start tracking progress
            startProgressTracking(data.jobId);

        } catch (error) {
            console.error('Error starting research:', error);
            // Keep results section visible on error
            progressSection.style.display = 'none';
            inputSection.style.display = 'block';
            resultsSection.style.display = 'block';
            alert(error.message || 'Failed to start research. Please try again.');
        }
    }

    async function cancelResearch() {
        if (currentJobId) {
            try {
                // Call cancel endpoint
                const response = await fetch(`${API_BASE_URL}/api/research/cancel/${currentJobId}`, {
                    method: 'POST'
                });

                if (!response.ok) {
                    throw new Error('Failed to cancel research');
                }

                // Update UI to show cancelled state
                progressBarFill.style.backgroundColor = '#ff4444'; // Red color for cancelled
                currentCompanySpan.textContent = 'Research cancelled';
                
                // Keep results visible but hide progress section
                progressSection.style.display = 'none';
                inputSection.style.display = 'block';
                resultsSection.style.display = 'block'; // Keep results visible
                
                // Clear the current job ID
                currentJobId = null;
            } catch (error) {
                console.error('Error cancelling research:', error);
                alert('Failed to cancel research. Please try again.');
            }
        }
    }

    async function startProgressTracking(jobId) {
        console.log('Starting progress tracking for job:', jobId);
        const processedCompanies = new Set();
        let previousCompany = null;
        let errorCount = 0;
        const MAX_ERRORS = 3;
        
        const interval = setInterval(async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/api/research/status/${jobId}`);
                if (!response.ok) {
                    throw new Error('Failed to get status');
                }

                // Reset error count on successful request
                errorCount = 0;

                const data = await response.json();
                console.log('Progress update:', data);
                
                // Update progress bar
                progressBarFill.style.width = `${data.progress}%`;
                
                // Clear loading state from previous company if we've moved to a new one
                if (previousCompany && previousCompany !== data.currentCompany) {
                    const rows = resultsBody.getElementsByTagName('tr');
                    for (let row of rows) {
                        if (row.cells[0].textContent === previousCompany) {
                            if (row.cells[1].textContent === 'Researching...') {
                                row.cells[1].textContent = 'N/A';
                            }
                            if (row.cells[2].textContent === 'Searching...') {
                                row.cells[2].textContent = 'Not found';
                            }
                        }
                    }
                }
                
                // Update current company being processed
                if (data.currentCompany) {
                    currentCompanySpan.textContent = data.currentCompany;
                    previousCompany = data.currentCompany;
                    // Only update loading state if company hasn't been processed yet
                    if (!processedCompanies.has(data.currentCompany)) {
                        const rows = resultsBody.getElementsByTagName('tr');
                        for (let row of rows) {
                            if (row.cells[0].textContent === data.currentCompany) {
                                // Clear any existing rows for this company
                                while (row.nextElementSibling && 
                                      row.nextElementSibling.cells[0].textContent === data.currentCompany) {
                                    resultsBody.removeChild(row.nextElementSibling);
                                }
                                row.cells[1].innerHTML = '<span class="loading-text">Researching...</span>';
                                row.cells[2].innerHTML = '<span class="loading-text">Searching...</span>';
                                break;
                            }
                        }
                    }
                }

                // Update results if new data is available
                if (data.results && data.results.length > currentResults.length) {
                    console.log('New results available:', data.results.length - currentResults.length);
                    const newResults = data.results.slice(currentResults.length);
                    await updateResultsTable(newResults);
                    // Mark companies as processed
                    newResults.forEach(result => {
                        if (result && result.companyName) {
                            processedCompanies.add(result.companyName);
                        }
                    });
                    currentResults = data.results;
                    updateSummary(data.results);
                }

                if (data.status === 'completed') {
                    clearInterval(interval);
                    console.log('Research completed');
                    // Clear any remaining loading states
                    const rows = resultsBody.getElementsByTagName('tr');
                    for (let row of rows) {
                        if (row.cells[1].textContent === 'Researching...') {
                            row.cells[1].textContent = 'N/A';
                        }
                        if (row.cells[2].textContent === 'Searching...') {
                            row.cells[2].textContent = 'Not found';
                        }
                    }
                    // Show completion message
                    currentCompanySpan.textContent = 'Research completed!';
                    progressBarFill.style.backgroundColor = '#4CAF50';
                    progressSection.style.display = 'none';
                    inputSection.style.display = 'block';
                    resultsSection.style.display = 'block'; // Keep results visible
                } else if (data.status === 'cancelled' || data.status === 'failed') {
                    clearInterval(interval);
                    // Clear any remaining loading states
                    const rows = resultsBody.getElementsByTagName('tr');
                    for (let row of rows) {
                        if (row.cells[1].textContent === 'Researching...') {
                            row.cells[1].textContent = 'N/A';
                        }
                        if (row.cells[2].textContent === 'Searching...') {
                            row.cells[2].textContent = 'Not found';
                        }
                    }
                    // Update UI
                    progressBarFill.style.backgroundColor = '#ff4444';
                    currentCompanySpan.textContent = data.status === 'cancelled' ? 'Research cancelled' : 'Research failed';
                    if (data.status === 'failed') alert('Research failed. Please try again.');
                    progressSection.style.display = 'none';
                    inputSection.style.display = 'block';
                    resultsSection.style.display = 'block'; // Keep results visible
                }
            } catch (error) {
                console.error('Error tracking progress:', error);
                errorCount++;
                
                if (errorCount >= MAX_ERRORS) {
                    clearInterval(interval);
                    // Keep results visible even on error
                    progressSection.style.display = 'none';
                    inputSection.style.display = 'block';
                    resultsSection.style.display = 'block';
                    alert('Failed to track progress. Please try again.');
                }
            }
        }, 2000);
    }

    async function updateResultsTable(newResults) {
        console.log('Updating results table with:', newResults);
        for (const result of newResults) {
            if (result) {
                // Find the first row for this company
                const rows = resultsBody.getElementsByTagName('tr');
                let firstCompanyRow = null;
                for (let row of rows) {
                    if (row.cells[0].textContent === result.companyName) {
                        firstCompanyRow = row;
                        break;
                    }
                }

                if (firstCompanyRow) {
                    console.log('Found matching row for company:', result.companyName);
                    
                    // Remove any existing rows for this company
                    while (firstCompanyRow.nextElementSibling && 
                           firstCompanyRow.nextElementSibling.cells[0].textContent === result.companyName) {
                        resultsBody.removeChild(firstCompanyRow.nextElementSibling);
                    }

                    // If no founder data found, mark as NOT FOUND
                    if (!result.foundersData || result.foundersData.length === 0) {
                        firstCompanyRow.innerHTML = `
                            <td>${result.companyName}</td>
                            <td>NOT FOUND</td>
                            <td>NOT FOUND</td>
                            <td>NOT FOUND</td>
                            <td>NOT FOUND</td>
                        `;
                        continue;
                    }

                    // Update or create rows for each founder
                    for (const [index, founder] of result.foundersData.entries()) {
                        let emailStatus = 'NOT FOUND';
                        let phoneStatus = 'NOT FOUND';

                        if (founder.linkedinUrl) {
                            try {
                                // Show loading state for contact details
                                if (index === 0) {
                                    firstCompanyRow.cells[3].textContent = 'Searching...';
                                    firstCompanyRow.cells[4].textContent = 'Searching...';
                                }

                                // Get email using Prospeo
                                const emailResponse = await fetch(`${API_BASE_URL}/api/research/email`, {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json'
                                    },
                                    body: JSON.stringify({ url: founder.linkedinUrl })
                                });

                                const emailData = await emailResponse.json();
                                emailStatus = emailData.email || 'Not Found';

                                // Get phone using Prospeo
                                const phoneResponse = await fetch(`${API_BASE_URL}/api/research/phone`, {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json'
                                    },
                                    body: JSON.stringify({ url: founder.linkedinUrl })
                                });

                                const phoneData = await phoneResponse.json();
                                phoneStatus = phoneData.phone || 'Not Found';

                            } catch (error) {
                                console.error('Error fetching contact details:', error);
                                if (error.message.includes('Out of Prospeo credits')) {
                                    emailStatus = 'Credit limit reached';
                                    phoneStatus = 'Credit limit reached';
                                } else {
                                    emailStatus = 'Not Found';
                                    phoneStatus = 'Not Found';
                                }
                            }
                        }

                        if (index === 0) {
                            // Update the first row
                            firstCompanyRow.innerHTML = `
                                <td>${result.companyName}</td>
                                <td>${founder.name || 'NOT FOUND'}</td>
                                <td>${founder.linkedinUrl ? 
                                    `<a href="${founder.linkedinUrl}" target="_blank">View Profile</a>` : 
                                    'NOT FOUND'}</td>
                                <td>${emailStatus}</td>
                                <td>${phoneStatus}</td>
                            `;
                        } else {
                            // Create additional rows for other founders
                            const newRow = document.createElement('tr');
                            newRow.innerHTML = `
                                <td>${result.companyName}</td>
                                <td>${founder.name || 'NOT FOUND'}</td>
                                <td>${founder.linkedinUrl ? 
                                    `<a href="${founder.linkedinUrl}" target="_blank">View Profile</a>` : 
                                    'NOT FOUND'}</td>
                                <td>${emailStatus}</td>
                                <td>${phoneStatus}</td>
                            `;
                            firstCompanyRow.parentNode.insertBefore(newRow, firstCompanyRow.nextElementSibling);
                        }
                    }
                } else {
                    console.log('No matching row found for company:', result.companyName);
                }
            }
        }
    }

    function updateSummary(results) {
        if (!results) return;
        
        totalCompaniesSpan.textContent = results.length;
        const totalFounders = results.reduce((sum, r) => 
            sum + (r.foundersData ? r.foundersData.length : 0), 0);
        totalFoundersSpan.textContent = totalFounders;
        const totalLinkedin = results.reduce((sum, r) => 
            sum + (r.foundersData ? r.foundersData.filter(f => f.linkedinUrl).length : 0), 0);
        totalLinkedinSpan.textContent = totalLinkedin;
    }

    async function downloadResults() {
        try {
            if (!currentResults || currentResults.length === 0) {
                alert('No results to download');
                return;
            }

            // Create Excel file in memory
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Company Details');

            // Add headers
            worksheet.columns = [
                { header: 'Company Name', key: 'companyName', width: 30 },
                { header: 'Founder Name', key: 'founderName', width: 25 },
                { header: 'LinkedIn URL', key: 'linkedInUrl', width: 50 },
                { header: 'Email', key: 'email', width: 35 },
                { header: 'Phone', key: 'phone', width: 20 }
            ];

            // Add data
            currentResults.forEach(result => {
                if (!result.foundersData || result.foundersData.length === 0) {
                    // Add row with NOT FOUND for companies with no data
                    worksheet.addRow({
                        companyName: result.companyName || 'N/A',
                        founderName: 'NOT FOUND',
                        linkedInUrl: 'NOT FOUND',
                        email: 'NOT FOUND',
                        phone: 'NOT FOUND'
                    });
                } else {
                    result.foundersData.forEach(founder => {
                        worksheet.addRow({
                            companyName: result.companyName || 'N/A',
                            founderName: founder.name || 'NOT FOUND',
                            linkedInUrl: founder.linkedinUrl || 'NOT FOUND',
                            email: founder.email || 'NOT FOUND',
                            phone: founder.phone || 'NOT FOUND'
                        });
                    });
                }
            });

            // Generate buffer
            const buffer = await workbook.xlsx.writeBuffer();
            
            // Create blob and download
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `company_details_${new Date().toISOString().split('T')[0]}.xlsx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (error) {
            console.error('Error downloading results:', error);
            alert('Failed to download results. Please try again.');
        }
    }

    function startNew() {
        // Reset file input
        fileInput.value = '';
        textarea.value = '';
        
        // If we have results, keep them visible
        if (currentResults && currentResults.length > 0) {
            inputSection.style.display = 'none';
            resultsSection.style.display = 'block';
            progressSection.style.display = 'none';
        } else {
            // Only reset everything if no results
            resultsSection.style.display = 'none';
            inputSection.style.display = 'block';
            progressSection.style.display = 'none';
            progressBarFill.style.width = '0%';
            currentCompanySpan.textContent = '-';
            resultsBody.innerHTML = '';
            currentResults = [];
        }
    }
});
