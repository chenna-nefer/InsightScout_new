import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { researchCompany, getCompanyNames, saveToExcel } from './services/research.js';
import { validateFile } from './middleware/fileValidation.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import axios from 'axios';
import dotenv from 'dotenv';
import { createServer } from 'http';
import fetch from 'node-fetch';




// Initialize dotenv
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Add API configuration
const PROSPEO_BASE_URL = 'https://api.prospeo.io/v1';
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const EXA_API_KEY = process.env.EXA_API_KEY;
const PROSPEO_API_KEY = process.env.PROSPEO_API_KEY;

// Add at the top of the file
const requiredEnvVars = {
    'PERPLEXITY_API_KEY': process.env.PERPLEXITY_API_KEY,
    'GROQ_API_KEY': process.env.GROQ_API_KEY,
    'EXA_API_KEY': process.env.EXA_API_KEY,
    'PROSPEO_API_KEY': process.env.PROSPEO_API_KEY
};

// Validate environment variables
const missingVars = Object.entries(requiredEnvVars)
    .filter(([_, value]) => !value)
    .map(([key]) => key);

if (missingVars.length > 0) {
    console.error('Missing required environment variables:', missingVars.join(', '));
    process.exit(1);
}

// Log API configurations (without exposing keys)
console.log('API Configurations:', {
    perplexity: !!process.env.PERPLEXITY_API_KEY,
    groq: !!process.env.GROQ_API_KEY,
    exa: !!process.env.EXA_API_KEY,
    prospeo: !!process.env.PROSPEO_API_KEY
});

const app = express();
const server = createServer(app);

// Before other middleware
const corsOptions = {
    origin: function (origin, callback) {
        const allowedOrigins = [
            'http://localhost:5500',
            'http://127.0.0.1:5500',
            'https://insightscout.onrender.com',
            'https://insightscout-new.onrender.com',
            'https://insightscout.onrender.com',
            undefined // Allow requests with no origin (like mobile apps or curl requests)
        ];
        
        if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Enable pre-flight requests for all routes
app.options('*', cors(corsOptions));

// Add security headers middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
    res.header('Access-Control-Max-Age', '86400'); // 24 hours
    next();
});

app.use(express.json());
app.use(express.static(join(__dirname, '../../public')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    apiKey: !!PROSPEO_API_KEY
  });
});

// Configure multer for memory storage
const upload = multer({ 
  storage: multer.memoryStorage(),
  fileFilter: validateFile,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Job tracking
const jobs = new Map();
const activeJobs = new Set();

// Add cleanup for completed jobs after 1 hour
setInterval(() => {
    const now = Date.now();
    for (const [jobId, job] of jobs.entries()) {
        if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
            if (now - job.lastUpdated > 3600000) { // 1 hour
                jobs.delete(jobId);
                activeJobs.delete(jobId);
            }
        }
    }
}, 300000); // Run every 5 minutes

// Helper function for Prospeo API calls
async function callProspeoAPI(endpoint, data) {
    console.log(`Calling Prospeo API: ${endpoint}`, data);
    
    const url = `${PROSPEO_BASE_URL}${endpoint}`;
    console.log('Full API URL:', url);

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${PROSPEO_API_KEY}`,
            'Accept': 'application/json'
        },
        body: JSON.stringify(data)
    });

    const responseText = await response.text();
    console.log(`Prospeo API Response (${endpoint}):`, responseText);

    if (!response.ok) {
        throw new Error(`Prospeo API error (${endpoint}): ${response.status} - ${responseText}`);
    }

    try {
        return responseText ? JSON.parse(responseText) : null;
    } catch (e) {
        console.error('Error parsing Prospeo response:', e);
        throw new Error(`Invalid response from Prospeo API: ${responseText}`);
    }
}

// API Routes
app.post('/api/research/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('Processing uploaded file:', req.file.originalname);
    
    // Create temp directory if it doesn't exist
    const tempDir = path.join(__dirname, '../../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Create a temporary file path in memory
    const tempFilePath = path.join(tempDir, `${Date.now()}-${req.file.originalname}`);
    
    // Write the buffer to a temporary file
    await fs.promises.writeFile(tempFilePath, req.file.buffer);
    
    const companies = await getCompanyNames(tempFilePath);
    
    // Clean up the temporary file
    await fs.promises.unlink(tempFilePath);
    
    if (!companies || companies.length === 0) {
      return res.status(400).json({ error: 'No valid company names found in the file' });
    }

    console.log('Found companies:', companies);
    const jobId = Date.now().toString();
    
    // Initialize job with timestamp
    jobs.set(jobId, {
      status: 'processing',
      progress: 0,
      total: companies.length,
      results: [],
      currentCompany: '',
      lastUpdated: Date.now(),
      error: null
    });
    
    // Add to active jobs
    activeJobs.add(jobId);
    
    // Start processing in background
    processCompanies(jobId, companies).catch(error => {
      console.error('Error processing companies:', error);
      updateJobStatus(jobId, 'failed', [], error.message);
    });
    
    // Return job ID immediately
    return res.json({ 
      jobId,
      total: companies.length,
      companies: companies
    });
  } catch (error) {
    console.error('Error processing file upload:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/research/text', async (req, res) => {
  try {
    const { companies } = req.body;
    if (!companies || !Array.isArray(companies)) {
      return res.status(400).json({ error: 'Invalid companies data' });
    }

    const jobId = Date.now().toString();
    
    // Initialize job
    jobs.set(jobId, {
      status: 'processing',
      progress: 0,
      total: companies.length,
      results: [],
      currentCompany: '',
      lastUpdated: Date.now(),
      error: null
    });
    
    // Start processing in background
    processCompanies(jobId, companies).catch(error => {
      console.error('Error processing companies:', error);
      updateJobStatus(jobId, 'failed', [], error.message);
    });
    
    // Return job ID immediately
    return res.json({ 
      jobId,
      total: companies.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update the status endpoint to include rate limiting
const statusChecks = new Map(); // Track status check frequencies

app.get('/api/research/status/:jobId', (req, res) => {
    try {
        const { jobId } = req.params;
        
        // Rate limiting
        const now = Date.now();
        const lastCheck = statusChecks.get(jobId) || 0;
        if (now - lastCheck < 2000) { // Minimum 2 seconds between checks
            return res.status(429).json({
                success: false,
                error: 'Too many status checks. Please wait.'
            });
        }
        statusChecks.set(jobId, now);

        console.log('Status request for jobId:', jobId);
        const job = jobs.get(jobId);
        
        if (!job) {
            console.log('Job not found');
            return res.status(404).json({ 
                success: false, 
                error: 'Job not found' 
            });
        }

        // Clear status check tracking if job is complete
        if (job.status === 'completed' || job.status === 'error') {
            statusChecks.delete(jobId);
        }

        res.json({
            success: true,
            status: job.status,
            progress: job.progress,
            currentCompany: job.currentCompany,
            results: job.results,
            error: job.error || null
        });

    } catch (error) {
        console.error('Error getting status:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Add cancel endpoint
app.post('/api/research/cancel/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  const job = jobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  // Mark job as cancelled
  job.isCancelled = true;
  job.status = 'cancelled';
  
  // Remove from active jobs
  activeJobs.delete(jobId);
  
  res.json({ message: 'Research cancelled successfully' });
});

// Update these endpoints to use the correct API URLs and headers
app.post('/api/research/email', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) {
            return res.status(400).json({ error: 'LinkedIn URL is required' });
        }

        console.log('Searching email for LinkedIn URL:', url);

        const response = await axios({
            method: 'POST',
            url: 'https://api.prospeo.io/social-url-enrichment', // Updated endpoint
            headers: {
                'Content-Type': 'application/json',
                'X-KEY': PROSPEO_API_KEY  // Updated header
            },
            data: { url } // Using url instead of linkedin_url
        });

        if (response.data?.error === false && response.data?.response?.email?.email) {
            const email = response.data.response.email.email;
            console.log('Found email:', email);
            return res.json({ email });
        }

        return res.json({ email: null });

    } catch (error) {
        console.error('Error finding email:', error);
        return res.status(500).json({ error: 'Failed to fetch email' });
    }
});

app.post('/api/research/phone', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) {
            return res.status(400).json({ error: 'LinkedIn URL is required' });
        }

        console.log('Searching phone for LinkedIn URL:', url);

        const response = await axios({
            method: 'POST',
            url: 'https://api.prospeo.io/mobile-finder', // Updated endpoint
            headers: {
                'Content-Type': 'application/json',
                'X-KEY': PROSPEO_API_KEY  // Updated header
            },
            data: { url } // Using url instead of linkedin_url
        });

        if (response.data?.error === false && response.data?.response?.raw_format) {
            const phone = response.data.response.raw_format;
            console.log('Found phone:', phone);
            return res.json({ phone });
        }

        return res.json({ phone: null });

    } catch (error) {
        console.error('Error finding phone number:', error);
        return res.status(500).json({ error: 'Failed to fetch phone number' });
    }
});

// Add cleanup endpoint
app.post('/api/research/cleanup/:jobId', (req, res) => {
  const { jobId } = req.params;
  
  if (jobs.has(jobId)) {
    jobs.delete(jobId);
    activeJobs.delete(jobId);
    res.json({ message: 'Job cleaned up successfully' });
  } else {
    res.status(404).json({ error: 'Job not found' });
  }
});

// Add new endpoint for loading companies
app.post('/api/research/load', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // Create temp directory if it doesn't exist
        const tempDir = path.join(__dirname, '../../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const tempFilePath = path.join(tempDir, `${Date.now()}-${req.file.originalname}`);
        await fs.promises.writeFile(tempFilePath, req.file.buffer);
        
        const companies = await getCompanyNames(tempFilePath);
        
        await fs.promises.unlink(tempFilePath);
        
        if (!companies || companies.length === 0) {
            return res.status(400).json({ error: 'No valid company names found in the file' });
        }

        res.json({ companies });

    } catch (error) {
        console.error('Error loading companies:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update research start endpoint
app.post('/api/research/start', async (req, res) => {
    try {
        const { companies } = req.body;
        if (!companies || !Array.isArray(companies) || companies.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid input: companies array is required' 
            });
        }

        const jobId = Date.now().toString();
        console.log('Creating new job with ID:', jobId);

        // Initialize job with more detailed structure
        const job = {
            id: jobId,
            companies,
            status: 'in_progress',
            progress: 0,
            currentCompany: companies[0],
            results: [],
            startTime: new Date().toISOString(),
            totalCompanies: companies.length
        };

        jobs.set(jobId, job);
        console.log('Job initialized:', job);

        // Send response to client
        res.json({ success: true, jobId });

        // Start processing
        processCompanies(jobId, companies);

    } catch (error) {
        console.error('Error starting research:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update the processCompanies function to handle timeouts and add proper delays
async function processCompanies(jobId, companies) {
    const job = jobs.get(jobId);
    const totalCompanies = companies.length;

    try {
        for (let i = 0; i < companies.length; i++) {
            if (job.status === 'cancelled') break;

            const company = companies[i];
            console.log(`Processing company ${i + 1}/${totalCompanies}: ${company}`);

            job.currentCompany = company;
            job.progress = Math.round((i / totalCompanies) * 100);
            jobs.set(jobId, { ...job });

            try {
                // Process with timeout safety
                const result = await Promise.race([
                    researchCompany(company),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Research timeout after 60 seconds')), 60000)
                    )
                ]);

                console.log(`Research result for ${company}:`, result);

                // Always add result to job results, even if some fields are "Not Found"
                job.results.push({
                    companyName: company,
                    foundersData: result.foundersData || [],
                    website: result.website || 'Not Found',
                    yearFounded: result.yearFounded || 'Not Found',
                    status: 'completed'
                });

            } catch (error) {
                console.error(`Error processing company ${company}:`, error);
                
                // Add result with error status but don't fail the whole job
                job.results.push({
                    companyName: company,
                    foundersData: [{
                        name: 'Not Found',
                        role: 'Not Found',
                        linkedinUrl: 'Not Found',
                        email: 'Not Found',
                        phone: 'Not Found'
                    }],
                    website: 'Not Found',
                    yearFounded: 'Not Found',
                    status: 'error',
                    error: error.message
                });
            }

            // Always update job status
            jobs.set(jobId, { ...job });
            
            // Add a delay between companies to avoid rate limits
            if (i < companies.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        // Mark job as completed when finished
        job.status = 'completed';
        job.progress = 100;
        jobs.set(jobId, { ...job });
        console.log(`Job ${jobId} completed successfully`);

    } catch (error) {
        console.error('Error in processCompanies:', error);
        // Only mark the job as error if something catastrophic happens
        // Individual company errors are already handled above
        job.status = 'error';
        job.error = error.message;
        jobs.set(jobId, { ...job });
    }
}

function updateJobProgress(jobId, progress, results, currentCompany = '') {
  const job = jobs.get(jobId);
  if (job) {
    job.progress = progress;
    job.results = results;
    job.currentCompany = currentCompany;
    job.lastUpdated = Date.now();
  }
}

function updateJobStatus(jobId, status, results = [], error = null) {
  const job = jobs.get(jobId);
  if (job) {
    job.status = status;
    if (results.length > 0) {
      job.results = results;
    }
    job.lastUpdated = Date.now();
    job.error = error;
    
    // If terminal state, start cleanup timer
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      setTimeout(() => {
        jobs.delete(jobId);
        activeJobs.delete(jobId);
      }, 3600000); // Clean up after 1 hour
    }
  }
}

// Start server
server.listen(process.env.PORT || 7501, () => {
  const port = process.env.PORT || 7501;
  console.log('\n===========================================');
  console.log(`InsightScout Server running on port ${port}`);
  console.log('===========================================');
  console.log('API Status:');
  console.log(`- Perplexity API: ${PERPLEXITY_API_KEY ? '✅ Connected' : '❌ Not configured'}`);
  console.log(`- GROQ API: ${GROQ_API_KEY ? '✅ Connected' : '❌ Not configured'}`);
  console.log(`- Exa API: ${EXA_API_KEY ? '✅ Connected' : '❌ Not configured'}`);
  console.log(`- Prospeo API: ${PROSPEO_API_KEY ? '✅ Connected' : '❌ Not configured'}`);
  console.log('===========================================');
  console.log('Server endpoints:');
  console.log(`- Health check: http://localhost:${port}/api/health`);
  console.log(`- Research start: http://localhost:${port}/api/research/start`);
  console.log('===========================================\n');
});

app.post('/api/research', async (req, res) => {
    const { companies } = req.body;
    try {
        const jobId = Date.now().toString();
        
        // Initialize job
        jobs.set(jobId, {
            status: 'processing',
            progress: 0,
            total: companies.length,
            results: [],
            currentCompany: '',
            lastUpdated: Date.now()
        });

        // Send initial response with jobId
        res.json({ jobId });

        // Process companies in background
        processCompanies(jobId, companies).catch(error => {
            console.error('Error processing companies:', error);
            updateJobStatus(jobId, 'failed', [], error.message);
        });

    } catch (error) {
        console.error('Research error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add this near your other routes
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        env: process.env.NODE_ENV,
        timestamp: new Date().toISOString()
    });
});

// Add this near your other routes
app.get('/test', (req, res) => {
    res.json({ message: 'Server is working' });
}); 