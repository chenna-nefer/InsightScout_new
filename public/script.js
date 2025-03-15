document.addEventListener('DOMContentLoaded', function() {
    // API Configuration
    const API_BASE_URL = 'https://insightscout-new.onrender.com';

    // DOM Elements with validation
    const elements = {};
    
    // Function to safely get DOM elements
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
            missingElements.push('input-section');
        }

        // If any elements are missing, throw error
        if (missingElements.length > 0) {
            throw new Error(`Missing required DOM elements: ${missingElements.join(', ')}`);
        }
    }

    try {
        // Initialize elements and validate their existence
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
                if (!elements.resultsBody || !elements.progressSection || !elements.resultsSection) {
                    throw new Error('Required DOM elements not found');
                }

                elements.resultsBody.innerHTML = '';
                updateTableWithCompanies(companies);
                
                elements.progressSection.style.display = 'block';
                elements.resultsSection.style.display = 'block';
                elements.progressBarFill.style.width = '0%';
                elements.currentCompanySpan.textContent = 'Starting research...';

                const requestOptions = {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    mode: 'cors',
                    body: JSON.stringify({ companies })
                };

                console.log('Sending request to:', `${API_BASE_URL}/api/research/start`);
                console.log('Request options:', requestOptions);

                const response = await fetch(`${API_BASE_URL}/api/research/start`, requestOptions);
                
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
                }

                const data = await response.json();
                console.log('Received response:', data);

                currentJobId = data.jobId;
                startProgressTracking(data.jobId);

            } catch (error) {
                console.error('Error in handleCompanySearch:', error);
                handleError(error);
            }
        }

        async function startProgressTracking(jobId) {
            const interval = setInterval(async () => {
                try {
                    const response = await fetch(`${API_BASE_URL}/api/research/status/${jobId}`, {
                        method: 'GET',
                        headers: {
                            'Accept': 'application/json'
                        },
                        mode: 'cors'
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }

                    const data = await response.json();

                    if (!response.ok) throw new Error('Failed to get status');

                    elements.progressBarFill.style.width = `${data.progress}%`;
                    
                    if (data.currentCompany) {
                        elements.currentCompanySpan.textContent = data.currentCompany;
                        updateCompanyStatus(data.currentCompany, 'Researching...');
                    }

                    if (data.results && data.results.length > 0) {
                        currentResults = data.results;
                        updateCompanyResults(data.results);
                    }

                    if (data.status === 'completed') {
                        clearInterval(interval);
                        handleCompletion();
                    }

                } catch (error) {
                    console.error('Error tracking progress:', error);
                    clearInterval(interval);
                }
            }, 2000);
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

                const reversedCompanies = [...loadedCompanies].reverse();
                elements.startResearchBtn.style.display = 'none';
                await handleCompanySearch(reversedCompanies);

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

                    elements.progressBarFill.style.backgroundColor = '#ff4444';
                    elements.currentCompanySpan.textContent = 'Research cancelled';
                    elements.progressSection.style.display = 'none';
                    elements.inputSection.style.display = 'block';
                    elements.resultsSection.style.display = 'block';
                    
                    currentJobId = null;
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
                            ${error.message || 'An error occurred during research'}
                        </td>
                    </tr>
                `;
            }
        }

        function handleCompletion() {
            elements.progressSection.style.display = 'none';
            elements.inputSection.style.display = 'block';
            elements.resultsSection.style.display = 'block';
            elements.currentCompanySpan.textContent = 'Research completed!';
            elements.progressBarFill.style.backgroundColor = '#4CAF50';
        }
    } catch (error) {
        console.error('Initialization error:', error);
        document.body.innerHTML = `
            <div style="color: red; padding: 20px; text-align: center;">
                <h2>Error Initializing Application</h2>
                <p>${error.message}</p>
            </div>
        `;
    }
});