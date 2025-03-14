import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { researchCompany, getCompanyNames, saveToExcel } from './services/research.js';
import { validateFile } from './middleware/fileValidation.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import axios from 'axios';
import dotenv from 'dotenv';

// Initialize dotenv
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// API Configuration
const PROSPEO_API_KEY = process.env.PROSPEO_API_KEY;
if (!PROSPEO_API_KEY) {
    console.error('Warning: PROSPEO_API_KEY is not set in environment variables');
}

// Log API key status (without revealing the key)
console.log('Prospeo API Key status:', PROSPEO_API_KEY ? 'Configured' : 'Missing');

const app = express();
const port = process.env.PORT || 7501;

// Middleware
app.use(cors({
  origin: [
    'http://localhost:5500', 
    'http://127.0.0.1:5500',
    'https://insightscout-new.onrender.com',
    'https://insightscout-new.onrender.com/'
  ],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));
app.use(express.json());

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
    processCompanies(companies, jobId).catch(error => {
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
    processCompanies(companies, jobId).catch(error => {
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

app.get('/api/research/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  // Include all relevant job information
  res.json({
    status: job.status,
    progress: job.progress,
    total: job.total,
    results: job.results,
    currentCompany: job.currentCompany,
    error: job.error,
    isActive: activeJobs.has(jobId)
  });
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

// Add these endpoints after other API routes
app.post('/api/research/email', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) {
            return res.status(400).json({ error: 'LinkedIn URL is required' });
        }

        if (!PROSPEO_API_KEY) {
            return res.status(500).json({ error: 'Prospeo API key not configured' });
        }

        const response = await axios({
            method: 'post',
            url: 'https://api.prospeo.io/social-url-enrichment',
            headers: {
                'Content-Type': 'application/json',
                'X-KEY': PROSPEO_API_KEY
            },
            data: { url }
        });

        if (response.data?.error === false && response.data?.response?.email?.email) {
            const email = response.data.response.email.email;
            const emailStatus = response.data.response.email.email_status;
            
            // Accept VALID emails as well
            if (emailStatus === 'VERIFIED' || emailStatus === 'ACCEPT_ALL' || emailStatus === 'VALID') {
                return res.json({ email });
            }
        }

        return res.json({ email: null });

    } catch (error) {
        console.error('Error finding email:', error.message);
        if (error.response?.data?.message === 'INSUFFICIENT_CREDITS') {
            return res.status(402).json({ error: 'Out of Prospeo credits' });
        }
        return res.status(500).json({ error: 'Failed to fetch email' });
    }
});

app.post('/api/research/phone', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) {
            return res.status(400).json({ error: 'LinkedIn URL is required' });
        }

        if (!PROSPEO_API_KEY) {
            return res.status(500).json({ error: 'Prospeo API key not configured' });
        }

        const response = await axios({
            method: 'post',
            url: 'https://api.prospeo.io/mobile-finder',
            headers: {
                'Content-Type': 'application/json',
                'X-KEY': PROSPEO_API_KEY
            },
            data: { url }
        });

        if (response.data?.error === false && response.data?.response?.raw_format) {
            const phone = response.data.response.raw_format;
            return res.json({ phone });
        }

        return res.json({ phone: null });

    } catch (error) {
        console.error('Error finding phone number:', error.message);
        if (error.response?.data?.message === 'INSUFFICIENT_CREDITS') {
            return res.status(402).json({ error: 'Out of Prospeo credits' });
        }
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
app.post('/api/research/start', express.json(), async (req, res) => {
    try {
        const { companies } = req.body;
        
        if (!companies || !Array.isArray(companies) || companies.length === 0) {
            return res.status(400).json({ error: 'No companies provided' });
        }

        const jobId = Date.now().toString();
        
        jobs.set(jobId, {
            status: 'processing',
            progress: 0,
            total: companies.length,
            results: [],
            currentCompany: '',
            lastUpdated: Date.now()
        });
        
        // Start processing in background
        processCompanies(companies, jobId);
        
        res.json({ jobId });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Helper functions
async function processCompanies(companies, jobId) {
  const results = [];
  let processed = 0;
  
  for (const company of companies) {
    // Check if job is cancelled
    const job = jobs.get(jobId);
    if (!job || job.isCancelled) {
      console.log(`Job ${jobId} was cancelled, stopping processing`);
      return;
    }

    try {
      if (!company) {
        console.log('Skipping empty company name');
        continue;
      }

      // Update current company being processed
      updateJobProgress(jobId, (processed / companies.length) * 100, results, company);
      
      console.log(`Processing company: ${company}`);
      const result = await researchCompany(company);
      
      if (result) {
        results.push(result);
        // Update results immediately after each company is processed
        updateJobProgress(jobId, ((processed + 1) / companies.length) * 100, results, company);
      }
      
      processed++;
      
      // Add delay between requests
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (error) {
      console.error(`Error processing ${company}:`, error);
      // Continue with next company even if one fails
      processed++;
      updateJobProgress(jobId, (processed / companies.length) * 100, results, company);
    }
  }

  // Only update status if not cancelled
  const job = jobs.get(jobId);
  if (!job || !job.isCancelled) {
    updateJobStatus(jobId, 'completed', results);
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
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
}); 