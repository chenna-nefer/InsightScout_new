document.addEventListener('DOMContentLoaded', function() {
    // API Configuration
    const API_BASE_URL = 'https://insightscout.onrender.com';
    // const API_BASE_URL = 'http://localhost:7501';
    
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

    // Get existing buttons and elements
    const loadDataBtn = document.createElement('button');
    loadDataBtn.className = 'button';
    loadDataBtn.id = 'load-data';
    loadDataBtn.textContent = 'Load Companies';
    
    // Insert load button before start research button
    startResearchBtn.parentNode.insertBefore(loadDataBtn, startResearchBtn);
    
    // Initially hide the start research button
    startResearchBtn.style.display = 'none';

    // Store companies data
    let loadedCompanies = [];

    // File Upload Handling
    fileInput.addEventListener('change', handleFileUpload);
    
    // Drag and Drop
    const fileUploadArea = document.querySelector('.file-upload');
    fileUploadArea.addEventListener('dragover', handleDragOver);
    fileUploadArea.addEventListener('drop', handleFileDrop);

    // Button Click Handlers
    loadDataBtn.addEventListener('click', () => fileInput.click());
    startResearchBtn.addEventListener('click', startResearchProcess);
    cancelResearchBtn.addEventListener('click', cancelResearch);
    downloadResultsBtn.addEventListener('click', downloadResults);
    startNewBtn.addEventListener('click', startNew);

    // File Upload Functions
    function handleFileUpload(e) {
        const file = e.target.files[0];
        if (file) {
            e.preventDefault();
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

    function validateAndLoadFile(file) {
        const validExtensions = ['.xlsx', '.csv'];
        const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
        
        if (validExtensions.includes(fileExtension)) {
            loadCompaniesData(file);
        } else {
            alert('Please upload an Excel (.xlsx) or CSV (.csv) file');
        }
    }

    // Research Process Functions
    async function loadCompaniesData(file) {
        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch(`${API_BASE_URL}/api/research/load`, {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to load companies');
            }

            loadedCompanies = data.companies;
            
            // Update table with companies
            updateTableWithCompanies(data.companies);
            
            // Show start research button, hide load button
            startResearchBtn.style.display = 'block';
            loadDataBtn.style.display = 'none';

            // Show results section with loaded data
            resultsSection.style.display = 'block';
            
            return data.companies;

        } catch (error) {
            console.error('Error loading companies:', error);
            handleError(error);
        }
    }

    function updateTableWithCompanies(companies) {
        // Clear existing table content
        resultsBody.innerHTML = '';
        
        // Update table headers
        const headerRow = document.querySelector('thead tr');
        headerRow.innerHTML = `
            <th>Company</th>
            <th>Status</th>
            <th>Founder</th>
            <th>LinkedIn</th>
            <th>Email</th>
            <th>Phone</th>
        `;
        
        // Add company rows
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
            resultsBody.appendChild(row);
        });

        // Update summary
        totalCompaniesSpan.textContent = companies.length;
    }

    async function startResearchProcess() {
        try {
            if (!loadedCompanies.length) {
                throw new Error('No companies loaded. Please load companies first.');
            }

            // Show progress section
            progressSection.style.display = 'block';
            startResearchBtn.style.display = 'none';
            
            // Reset progress bar
            progressBarFill.style.width = '0%';
            currentCompanySpan.textContent = 'Starting research...';

            const response = await fetch(`${API_BASE_URL}/api/research/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ companies: loadedCompanies })
            });

            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Failed to start research');
            }

            currentJobId = data.jobId;
            
            // Start progress tracking
            startProgressTracking(data.jobId);

        } catch (error) {
            console.error('Error starting research:', error);
            handleError(error);
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
        const interval = setInterval(async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/api/research/status/${jobId}`);
                const data = await response.json();

                if (!response.ok) throw new Error('Failed to get status');

                // Update progress bar
                progressBarFill.style.width = `${data.progress}%`;

                // Update current company status
                if (data.currentCompany) {
                    currentCompanySpan.textContent = data.currentCompany;
                    updateCompanyStatus(data.currentCompany, 'Researching...');
                }

                // Update results
                if (data.results && data.results.length > 0) {
                    updateCompanyResults(data.results);
                }

                // Handle completion
                if (data.status === 'completed') {
                    clearInterval(interval);
                    handleCompletion();
                }

            } catch (error) {
                console.error('Error tracking progress:', error);
            }
        }, 2000);
    }

    function updateCompanyStatus(companyName, status) {
        const rows = resultsBody.getElementsByTagName('tr');
        for (let row of rows) {
            if (row.cells[0].textContent === companyName) {
                row.cells[1].innerHTML = `<span class="status-text">${status}</span>`;
                break;
            }
        }
    }

    function updateCompanyResults(results) {
        results.forEach(result => {
            if (!result.companyName) return;

            const rows = resultsBody.getElementsByTagName('tr');
            for (let row of rows) {
                if (row.cells[0].textContent === result.companyName) {
                    if (result.foundersData && result.foundersData.length > 0) {
                        const founder = result.foundersData[0];
                        row.cells[2].textContent = founder.name || 'Not Found';
                        row.cells[3].innerHTML = founder.linkedinUrl && founder.linkedinUrl !== 'Not Found' ? 
                            `<a href="${founder.linkedinUrl}" target="_blank">View Profile</a>` : 
                            'Not Found';
                        row.cells[4].textContent = founder.email || 'Not Found';
                        row.cells[5].textContent = founder.phone || 'Not Found';
                        row.cells[1].innerHTML = '<span class="status-text completed">Completed</span>';
                    } else {
                        row.cells[2].textContent = 'Not Found';
                        row.cells[3].textContent = 'Not Found';
                        row.cells[4].textContent = 'Not Found';
                        row.cells[5].textContent = 'Not Found';
                        row.cells[1].innerHTML = '<span class="status-text">No Results</span>';
                    }
                    break;
                }
            }
        });
    }

    function handleCompletion() {
        progressSection.style.display = 'none';
        inputSection.style.display = 'block';
        resultsSection.style.display = 'block';
        currentCompanySpan.textContent = 'Research completed!';
        progressBarFill.style.backgroundColor = '#4CAF50';
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
        // Reset file input but keep the results visible
        fileInput.value = '';
        textarea.value = '';
        
        // Show input section for new upload while keeping results
        inputSection.style.display = 'block';
        progressSection.style.display = 'none';
        
        // Only hide results if there are none
        if (!currentResults || currentResults.length === 0) {
            resultsSection.style.display = 'none';
            resultsBody.innerHTML = '';
        }
    }

    // Event Listeners
    loadDataBtn.addEventListener('click', () => fileInput.click());
});
