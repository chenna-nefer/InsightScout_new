document.addEventListener('DOMContentLoaded', async function() {
    // Store the original HTML content
    const originalHtml = document.body.innerHTML;

    // API Configuration
    const API_BASE_URL = window.location.hostname.includes('127.0.0.1') 
        ? 'http://localhost:7501'
        : 'https://insightscout.onrender.com';

    // Define elements object globally within the scope
    const elements = {};

    // Add this at the top level
    let progressInterval = null;

    // Define the initialization function
    function initializeElements() {
        const requiredElements = {
            'file-input': 'fileInput',
            'start-research': 'startResearchBtn',
            'cancel-research': 'cancelResearchBtn',
            'download-results': 'downloadResultsBtn',
            'start-new': 'startNewBtn',
            'progress-section': 'progressSection',
            'results-section': 'resultsSection',
            'progress-bar-fill': 'progressBarFill',
            'current-company': 'currentCompanySpan',
            'results-body': 'resultsBody',
            'company-name-input': 'companyNameInput',
            'search-company': 'searchCompanyBtn',
            'total-companies': 'totalCompanies',
            'total-founders': 'totalFounders',
            'total-linkedin': 'totalLinkedin'
        };

        const missingElements = [];
        
        // Get all elements and track missing ones
        for (const [id, key] of Object.entries(requiredElements)) {
            const element = document.getElementById(id);
            if (element) {
                elements[key] = element;
            } else {
                missingElements.push(id);
            }
        }

        // Get input section using class
        elements.inputSection = document.querySelector('.input-section');
        if (!elements.inputSection) {
            missingElements.push('input-section (class)');
        }

        // If any elements are missing, throw error with specific details
        if (missingElements.length > 0) {
            throw new Error(`Missing required DOM elements: ${missingElements.join(', ')}`);
        }
    }

    try {
        // Show loading state
        document.body.innerHTML = `
            <div style="text-align: center; padding: 20px;">
                <h2>Connecting to server...</h2>
                <p>Please wait...</p>
            </div>
        `;

        // Check server health
        const isHealthy = await checkServerHealth();
        if (!isHealthy) {
            throw new Error('Unable to connect to server');
        }

        // Restore the original HTML content before initializing elements
        document.body.innerHTML = originalHtml;

        // Now initialize elements
        initializeElements();
        
        // State management
        let currentResults = [];
        let currentJobId = null;
        let loadedCompanies = [];

        // Create and add load data button
        const loadDataBtn = document.createElement('button');
        loadDataBtn.className = 'button';
        loadDataBtn.id = 'load-data';
        loadDataBtn.textContent = 'Load Companies';
        elements.startResearchBtn.parentNode.insertBefore(loadDataBtn, elements.startResearchBtn);
        elements.startResearchBtn.style.display = 'none';

        // Hide duplicate download/new buttons in the button group
        if (document.querySelector('#button-group')) {
            document.querySelector('#button-group').style.display = 'none';
        }

        // Event Listeners
        loadDataBtn.addEventListener('click', () => elements.fileInput.click());
        elements.fileInput.addEventListener('change', handleFileUpload);
        elements.startResearchBtn.addEventListener('click', startResearchProcess);
        elements.cancelResearchBtn.addEventListener('click', cancelResearch);
        elements.downloadResultsBtn.addEventListener('click', downloadResults);
        elements.startNewBtn.addEventListener('click', startNew);

        // File upload area event listeners
        const fileUploadArea = document.querySelector('.file-upload');
        if (fileUploadArea) {
            fileUploadArea.addEventListener('dragover', handleDragOver);
            fileUploadArea.addEventListener('drop', handleFileDrop);
        }

        // Search company button handler
        elements.searchCompanyBtn.addEventListener('click', async () => {
            const companyName = elements.companyNameInput.value.trim();
            if (!companyName) {
                alert('Please enter a company name');
                return;
            }

            elements.searchCompanyBtn.disabled = true;
            try {
                await handleCompanySearch([companyName]);
            } catch (error) {
                handleError(error);
            } finally {
                elements.searchCompanyBtn.disabled = false;
            }
        });

        // File handling functions
        function handleFileUpload(e) {
            const file = e.target.files[0];
            if (file) {
                validateAndLoadFile(file);
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
                validateAndLoadFile(file);
            }
        }

        function validateAndLoadFile(file) {
            const validExtensions = ['.xlsx', '.csv'];
            const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
            
            if (validExtensions.includes(fileExtension)) {
                loadCompaniesData(file);
            } else {
                alert('Please upload an Excel (.xlsx) or CSV (.csv) file');
            }
        }

        // Research process functions
        async function loadCompaniesData(file) {
            try {
                const formData = new FormData();
                formData.append('file', file);

                const response = await fetch(`${API_BASE_URL}/api/research/load`, {
                    method: 'POST',
                    body: formData
                });

                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Failed to load companies');

                loadedCompanies = data.companies;
                updateTableWithCompanies(data.companies);
                
                elements.startResearchBtn.style.display = 'block';
                loadDataBtn.style.display = 'none';
                elements.resultsSection.style.display = 'block';

            } catch (error) {
                handleError(error);
            }
        }

        async function handleCompanySearch(companies) {
            try {
                console.log('Starting company search with:', companies);

                if (!elements.resultsBody || !elements.progressSection || !elements.resultsSection) {
                    throw new Error('Required DOM elements not found');
                }

                // Update UI
                elements.resultsBody.innerHTML = '';
                updateTableWithCompanies(companies);
                elements.progressSection.style.display = 'block';
                elements.resultsSection.style.display = 'block';
                elements.progressBarFill.style.width = '0%';
                elements.currentCompanySpan.textContent = 'Starting research...';

                // Make the API request
                console.log('Sending request to:', `${API_BASE_URL}/api/research/start`);
                
                const response = await fetch(`${API_BASE_URL}/api/research/start`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({ companies })
                });

                if (!response.ok) {
                    throw new Error(`Server error: ${response.status}`);
                }

                // Log response details
                console.log('Response status:', response.status);
                console.log('Response headers:', Object.fromEntries(response.headers.entries()));

                const responseText = await response.text();
                console.log('Raw response:', responseText);

                if (!responseText) {
                    throw new Error('Empty response from server');
                }

                const data = JSON.parse(responseText);
                console.log('Parsed response:', data);

                if (!data.success || !data.jobId) {
                    throw new Error(data.error || 'Invalid response from server');
                }

                currentJobId = data.jobId;
                console.log('Received jobId:', data.jobId);
                startProgressTracking(data.jobId);

            } catch (error) {
                console.error('Error in handleCompanySearch:', error);
                handleError(error);
                elements.searchCompanyBtn.disabled = false;
            }
        }

        async function startProgressTracking(jobId) {
            if (progressInterval) {
                clearInterval(progressInterval);
            }
            
            progressInterval = setInterval(async () => {
                try {
                    const response = await fetch(`${API_BASE_URL}/api/research/status/${jobId}`);
                    
                    if (response.status === 429) {
                        // Rate limit hit, skip this check
                        return;
                    }

                    if (!response.ok) {
                        throw new Error(`Status check failed: ${response.status}`);
                    }

                    const data = await response.json();
                    
                    if (data.error) {
                        throw new Error(data.error);
                    }

                    elements.progressBarFill.style.width = `${data.progress}%`;
                    
                    if (data.currentCompany) {
                        elements.currentCompanySpan.textContent = data.currentCompany;
                    }

                    if (data.results && data.results.length > 0) {
                        // Store current results for download functionality
                        currentResults = data.results;
                        updateCompanyResults(data.results);
                    }

                    if (data.status === 'completed' || data.status === 'error') {
                        clearInterval(progressInterval);
                        handleCompletion(data);
                    }

                } catch (error) {
                    console.error('Error tracking progress:', error);
                    clearInterval(progressInterval);
                }
            }, 2000); // Check every 2 seconds
        }

        function updateTableWithCompanies(companies) {
            elements.resultsBody.innerHTML = '';
            
            companies.forEach(companyName => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${companyName}</td>
                    <td><span class="status-text">Pending</span></td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                `;
                elements.resultsBody.appendChild(row);
            });

            elements.totalCompanies.textContent = companies.length;
        }

        function updateCompanyResults(results) {
            elements.resultsBody.innerHTML = '';

            results.forEach(result => {
                if (result.foundersData && result.foundersData.length > 0) {
                    result.foundersData.forEach((founder, index) => {
                        const row = document.createElement('tr');
                        row.innerHTML = `
                            <td>${index === 0 ? result.companyName : ''}</td>
                            <td><span class="status-text completed">Completed</span></td>
                            <td>${founder.name || 'Not Found'}</td>
                            <td>${founder.linkedinUrl && founder.linkedinUrl !== 'Not Found' ? 
                                `<a href="${founder.linkedinUrl}" target="_blank">View Profile</a>` : 
                                'Not Found'}</td>
                            <td>${founder.email || 'Not Found'}</td>
                            <td>${founder.phone || 'Not Found'}</td>
                        `;
                        elements.resultsBody.appendChild(row);
                    });
                } else {
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td>${result.companyName}</td>
                        <td><span class="status-text completed">Completed</span></td>
                        <td>Not Found</td>
                        <td>Not Found</td>
                        <td>Not Found</td>
                        <td>Not Found</td>
                    `;
                    elements.resultsBody.appendChild(row);
                }
            });

            updateSummaryCounts(results);
        }

        function updateCompanyStatus(companyName, status) {
            const rows = elements.resultsBody.getElementsByTagName('tr');
            for (let row of rows) {
                if (row.cells[0].textContent === companyName) {
                    row.cells[1].innerHTML = `<span class="status-text">${status}</span>`;
                    break;
                }
            }
        }

        function updateSummaryCounts(results) {
            const counts = {
                totalCompanies: results.length,
                totalFounders: 0,
                totalLinkedin: 0
            };

            results.forEach(result => {
                if (result.foundersData) {
                    counts.totalFounders += result.foundersData.length;
                    counts.totalLinkedin += result.foundersData.filter(f => 
                        f.linkedinUrl && f.linkedinUrl !== 'Not Found'
                    ).length;
                }
            });

            elements.totalCompanies.textContent = counts.totalCompanies;
            elements.totalFounders.textContent = counts.totalFounders;
            elements.totalLinkedin.textContent = counts.totalLinkedin;
        }

        async function startResearchProcess() {
            try {
                if (!loadedCompanies.length) {
                    throw new Error('No companies loaded. Please load companies first.');
                }

                // Use companies in their original order (not reversed)
                elements.startResearchBtn.style.display = 'none';
                await handleCompanySearch(loadedCompanies);

            } catch (error) {
                handleError(error);
            }
        }

        async function cancelResearch() {
            if (currentJobId) {
                try {
                    const response = await fetch(`${API_BASE_URL}/api/research/cancel/${currentJobId}`, {
                        method: 'POST'
                    });

                    if (!response.ok) throw new Error('Failed to cancel research');
                    
                    // Clear the progress tracking interval
                    if (progressInterval) {
                        clearInterval(progressInterval);
                        progressInterval = null;
                    }

                    // Update UI to show canceled state
                    elements.progressBarFill.style.width = '100%';
                    elements.progressBarFill.style.backgroundColor = '#ff4444';
                    elements.currentCompanySpan.textContent = 'Research cancelled';
                    
                    // Show correct sections
                    elements.progressSection.style.display = 'none';
                    elements.inputSection.style.display = 'block';
                    
                    if (currentResults && currentResults.length > 0) {
                        elements.resultsSection.style.display = 'block';
                    } else {
                        elements.resultsSection.style.display = 'none';
                    }
                    
                    // Reset state
                    currentJobId = null;
                    
                    console.log('Research canceled successfully');
                    
                } catch (error) {
                    console.error('Error cancelling research:', error);
                    alert('Failed to cancel research. Please try again.');
                }
            }
        }

        async function downloadResults() {
            try {
                if (!currentResults || currentResults.length === 0) {
                    alert('No results to download');
                    return;
                }

                const workbook = new ExcelJS.Workbook();
                const worksheet = workbook.addWorksheet('Company Details');

                worksheet.columns = [
                    { header: 'Company Name', key: 'companyName', width: 30 },
                    { header: 'Founder Name', key: 'founderName', width: 25 },
                    { header: 'LinkedIn URL', key: 'linkedInUrl', width: 50 },
                    { header: 'Email', key: 'email', width: 35 },
                    { header: 'Phone', key: 'phone', width: 20 }
                ];

                currentResults.forEach(result => {
                    if (!result.foundersData || result.foundersData.length === 0) {
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

                const buffer = await workbook.xlsx.writeBuffer();
                const blob = new Blob([buffer], { 
                    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
                });
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
            elements.fileInput.value = '';
            elements.inputSection.style.display = 'block';
            elements.progressSection.style.display = 'none';
            
            if (!currentResults || currentResults.length === 0) {
                elements.resultsSection.style.display = 'none';
                elements.resultsBody.innerHTML = '';
            }
        }

        function handleError(error) {
            console.error('Error:', error);
            if (elements.resultsBody) {
                elements.resultsBody.innerHTML = `
                    <tr>
                        <td colspan="6" class="error-message">
                            ${error.message || 'An unexpected error occurred. Please try again.'}
                        </td>
                    </tr>
                `;
            }
            
            // Reset UI states
            if (elements.progressSection) {
                elements.progressSection.style.display = 'none';
            }
            if (elements.inputSection) {
                elements.inputSection.style.display = 'block';
            }
        }

        function handleCompletion(data) {
            elements.progressSection.style.display = 'none';
            elements.inputSection.style.display = 'block';
            elements.resultsSection.style.display = 'block';
            elements.currentCompanySpan.textContent = 'Research completed!';
            elements.progressBarFill.style.backgroundColor = '#4CAF50';
            
            // Make sure we have the final results for download
            if (data.results && data.results.length > 0) {
                currentResults = data.results;
            }
        }

        // Update health check function
        async function checkServerHealth() {
            try {
                console.log('Checking server health...');
                const response = await fetch(`${API_BASE_URL}/api/health`);
                
                if (!response.ok) {
                    console.error('Health check failed:', response.status, response.statusText);
                    return false;
                }

                const text = await response.text();
                console.log('Health check response:', text);

                try {
                    const data = JSON.parse(text);
                    return data.status === 'ok';
                } catch (parseError) {
                    console.error('Failed to parse health check response:', parseError);
                    return false;
                }
            } catch (error) {
                console.error('Health check error:', error);
                return false;
            }
        }

        // Add cleanup
        window.addEventListener('beforeunload', () => {
            if (progressInterval) {
                clearInterval(progressInterval);
            }
        });

        // Add this function to handle API errors
        function handleApiError(error, company) {
            console.error(`Error processing ${company}:`, error);
            
            let errorMessage = 'An unexpected error occurred.';
            if (error.response) {
                if (error.response.status === 400) {
                    errorMessage = 'Invalid request. Please check the company name.';
                } else if (error.response.status === 401) {
                    errorMessage = 'API authentication failed. Please check API keys.';
                } else if (error.response.status === 429) {
                    errorMessage = 'API rate limit exceeded. Please try again later.';
                }
            }

            return {
                companyName: company,
                foundersData: [{
                    name: 'Error',
                    role: errorMessage,
                    linkedinUrl: 'Not Found',
                    email: 'Not Found',
                    phone: 'Not Found'
                }],
                status: 'error'
            };
        }
    } catch (error) {
        console.error('Initialization error:', error);
        document.body.innerHTML = `
            <div style="color: red; padding: 20px; text-align: center;">
                <h2>Error Initializing Application</h2>
                <p>${error.message}</p>
                <p style="font-size: 0.9em; margin-top: 10px;">Please ensure all required HTML elements are present.</p>
                <button onclick="location.reload()" 
                        style="padding: 10px 20px; margin-top: 20px; cursor: pointer;">
                    Retry
                </button>
            </div>
        `;
    }
});