import xlsx from 'xlsx';
import { parse } from 'csv-parse';
import fs from 'fs';
import axios from 'axios';
import Exa from 'exa-js';
import { Groq } from 'groq-sdk';
import dotenv from 'dotenv';
import path from 'path';

// Initialize dotenv and APIs
dotenv.config();
const exa = new Exa(process.env.EXA_API_KEY);
const groqClient = new Groq();

// 1. First, get basic company info from Perplexity
async function getCompanyData(companyName) {
    try {
        const options = {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "sonar",
                messages: [
                    {
                        role: "system",
                        content: "Be precise and concise. Return information in a clear format."
                    },
                    {
                        role: "user",
                        content: `Please provide detailed information about ${companyName}, specifically:
                            1. Full company name
                            2. Website
                            3. ALL founders and co-founders (this is very important - list ALL founders)
                            4. Year founded
                            5. Location`
                    }
                ],
                temperature: 0.1,
                max_tokens: 1024
            })
        };

        const response = await fetch('https://api.perplexity.ai/chat/completions', options);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(`Perplexity API error: ${data.error || 'Unknown error'}`);
        }

        console.log('Perplexity Raw Response:', data.choices[0].message.content);
        
        // Extract structured data using Groq
        const structuredData = await extractFounderData(data.choices[0].message.content);
        console.log('Structured Data:', structuredData);
        return structuredData;
    } catch (error) {
        console.error('Error getting company data:', error);
        throw error;
    }
}

// 2. Extract structured data using Groq
async function extractFounderData(text) {
    try {
        const prompt = `Extract the following information from the text as JSON:
        {
            "companyName": "full company name",
            "website": "website or null if not found",
            "yearFounded": "year or null if not found",
            "location": "location or null if not found",
            "founders": [
                {
                    "name": "founder full name",
                    "role": "founder role",
                    "yearJoined": "year joined or null"
                }
            ]
        }
        Ensure ALL founders are included in the array.
        Text: ${text}`;

        const response = await groqClient.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'mixtral-8x7b-32768',
            temperature: 0.1,
            max_tokens: 1024
        });

        const jsonStr = response.choices[0].message.content;
        return JSON.parse(jsonStr);
    } catch (error) {
        console.error('Error extracting founder data:', error);
        throw error;
    }
}

// Simplified LinkedIn profile search function
async function findLinkedInProfile(founderName, companyName) {
    try {
        const query = `site:linkedin.com/in/ ${founderName} ${companyName}`;
        console.log('Search query:', query);

        // Correct way to use Exa API
        const response = await exa.search(query, {
            type: 'keyword',
            numResults: 1
        });

        if (response.results && response.results.length > 0) {
            const url = response.results[0].url;
            console.log('Found LinkedIn URL:', url);
            return url;
        }

        console.log('No LinkedIn profile found');
        return 'Not Found';
    } catch (error) {
        console.error('Error finding LinkedIn profile:', error);
        return 'Not Found';
    }
}

// Enhanced scoring function
function calculateMatchScore(result, founderName, companyName) {
    let score = 0;
    const content = (result.title + ' ' + result.snippet).toLowerCase();
    const url = result.url.toLowerCase();
    
    // Split names into parts
    const nameWords = founderName.toLowerCase().split(' ');
    const companyWords = companyName.toLowerCase().split(' ');

    // URL checks (weighted heavily)
    if (url.includes('linkedin.com/in/')) {
        score += 3;
        
        // Check if name appears in LinkedIn URL
        const urlPath = url.split('linkedin.com/in/')[1];
        if (nameWords.some(word => urlPath.includes(word.toLowerCase()))) {
            score += 3;
        }
    }

    // Name matching (critical)
    let nameMatchCount = 0;
    nameWords.forEach(word => {
        if (content.includes(word)) {
            nameMatchCount++;
            score += 2;
        }
    });
    
    // Bonus for full name match
    if (nameMatchCount === nameWords.length) {
        score += 3;
    }

    // Company matching
    let companyMatchCount = 0;
    companyWords.forEach(word => {
        if (word.length > 2 && content.includes(word)) { // Ignore very short words
            companyMatchCount++;
            score += 1;
        }
    });
    
    // Bonus for full company match
    if (companyMatchCount === companyWords.length) {
        score += 2;
    }

    // Role/position matching (important context)
    const roleIndicators = {
        'founder': 3,
        'co-founder': 3,
        'cofounder': 3,
        'ceo': 3,
        'chief': 2,
        'director': 2,
        'president': 2,
        'owner': 2
    };

    Object.entries(roleIndicators).forEach(([role, points]) => {
        if (content.includes(role)) {
            score += points;
        }
    });

    // Current role indicators
    if (content.includes('present') || content.includes('current')) {
        score += 1;
    }

    return score;
}

// Add these helper functions for email and phone
async function getFounderEmail(linkedinUrl) {
    try {
        const response = await axios({
            method: 'post',
            url: 'https://api.prospeo.io/social-url-enrichment',
            headers: {
                'Content-Type': 'application/json',
                'X-KEY': process.env.PROSPEO_API_KEY
            },
            data: { url: linkedinUrl }
        });

        if (response.data?.error === false && response.data?.response?.email?.email) {
            return { email: response.data.response.email.email };
        }
        return { email: 'Not Found' };
    } catch (error) {
        console.error('Error getting email:', error.message);
        return { email: 'Not Found' };
    }
}

async function getFounderPhone(linkedinUrl) {
    try {
        const response = await axios({
            method: 'post',
            url: 'https://api.prospeo.io/mobile-finder',
            headers: {
                'Content-Type': 'application/json',
                'X-KEY': process.env.PROSPEO_API_KEY
            },
            data: { url: linkedinUrl }
        });

        if (response.data?.error === false && response.data?.response?.raw_format) {
            return { phone: response.data.response.raw_format };
        }
        return { phone: 'Not Found' };
    } catch (error) {
        console.error('Error getting phone:', error.message);
        return { phone: 'Not Found' };
    }
}

// 4. Main research function
export async function researchCompany(companyName) {
    console.log(`\n=== Researching Company: ${companyName} ===`);
    
    try {
        const rawData = await getCompanyData(companyName);
        if (!rawData) {
            return { 
                companyName, 
                foundersData: [{ 
                    name: 'Not Found',
                    role: 'Not Found',
                    linkedinUrl: 'Not Found',
                    email: 'Not Found',
                    phone: 'Not Found'
                }],
                website: 'Not Found'
            };
        }

        const { founders, website, yearFounded } = rawData;
        
        const foundersData = [];
        const processedFounders = new Set();
        
        for (const founder of founders) {
            if (!founder?.name || founder.name === 'Not mentioned') continue;

            // Skip if we've already processed this founder
            if (processedFounders.has(founder.name)) continue;
            processedFounders.add(founder.name);
            
            console.log(`\n👤 Processing founder: ${founder.name}`);
            
            const linkedinUrl = await findLinkedInProfile(founder.name, companyName);
            
            // Comment out Prospeo API calls
            /*const [emailData, phoneData] = await Promise.all([
                getFounderEmail(linkedinUrl || ''),
                getFounderPhone(linkedinUrl || '')
            ]);*/

            foundersData.push({
                name: founder.name,
                role: founder.role || 'Not Found',
                linkedinUrl: linkedinUrl || 'Not Found',
                email: 'Not Found',
                phone: 'Not Found'
            });
        }

        // If no founders were found or processed, add a default "Not Found" entry
        if (foundersData.length === 0) {
            foundersData.push({
                name: 'Not Found',
                role: 'Not Found',
                linkedinUrl: 'Not Found',
                email: 'Not Found',
                phone: 'Not Found'
            });
        }

        return { 
            companyName, 
            foundersData,
            website: website || 'Not Found',
            yearFounded: yearFounded || 'Not Found'
        };

    } catch (error) {
        console.error('Error researching company:', error.message);
        return { 
            companyName, 
            foundersData: [{
                name: 'Not Found',
                role: 'Not Found',
                linkedinUrl: 'Not Found',
                email: 'Not Found',
                phone: 'Not Found'
            }], 
            website: 'Not Found',
            yearFounded: 'Not Found'
        };
    }
}

// Export the function that was previously only used internally
export async function getCompanyNames(filePath) {
  const extension = filePath.split('.').pop().toLowerCase();
  
  if (extension === 'xlsx') {
    return getCompaniesFromExcel(filePath);
  } else if (extension === 'csv') {
    return getCompaniesFromCSV(filePath);
  }
  
  throw new Error('Unsupported file format');
}

// Make sure these helper functions are defined in the file
async function getCompaniesFromExcel(filePath) {
  try {
    console.log('Reading Excel file:', filePath);
    const workbook = xlsx.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(sheet);
    
    if (!data || data.length === 0) {
      console.error('No data found in Excel file');
      return [];
    }
    
    console.log('Excel columns:', Object.keys(data[0] || {}));
    console.log('First row data:', data[0]);
    
    const possibleColumnNames = [
      'Company',
      'company',
      'Company Name',
      'company_name',
      'Name',
      'name',
      'Organization',
      'organization',
      'Business',
      'business',
      'Company ', // Note the space after Company
      ' Company', // Note the space before Company
      'Company Name ', // Note the space after Name
      ' Company Name' // Note the space before Company
    ];

    const companies = data.map(row => {
      for (const colName of possibleColumnNames) {
        if (row[colName]) {
          const companyName = row[colName].toString().trim();
          if (companyName && companyName !== 'undefined') {
            return companyName;
          }
        }
      }
      
      const firstValue = Object.values(row)[0];
      if (firstValue) {
        const companyName = firstValue.toString().trim();
        if (companyName && companyName !== 'undefined') {
          return companyName;
        }
      }
      
      return null;
    }).filter(Boolean);

    console.log(`Found ${companies.length} companies:`, companies);
    
    if (companies.length === 0) {
      console.error('No valid company names found in Excel file');
      return [];
    }

    return companies;
  } catch (error) {
    console.error('Error reading Excel file:', error);
    throw error;
  }
}

async function getCompaniesFromCSV(filePath) {
  return new Promise((resolve, reject) => {
    const companies = [];
    fs.createReadStream(filePath)
      .pipe(parse({
        columns: true,
        skip_empty_lines: true
      }))
      .on('data', (row) => {
        const possibleColumnNames = [
          'Company',
          'company',
          'Company Name',
          'company_name',
          'Name',
          'name',
          'Organization',
          'organization',
          'Business',
          'business'
        ];

        for (const colName of possibleColumnNames) {
          if (row[colName]) {
            companies.push(row[colName].toString().trim());
            return;
          }
        }
        
        const firstValue = Object.values(row)[0]?.toString().trim();
        if (firstValue) {
          companies.push(firstValue);
        }
      })
      .on('end', () => {
        const validCompanies = companies.filter(company => company && company !== 'undefined');
        console.log('Extracted companies from CSV:', validCompanies);
        resolve(validCompanies);
      })
      .on('error', reject);
  });
}

// Make sure to export saveToExcel as well since it's imported in index.js
export async function saveToExcel(results) {
  // ... existing saveToExcel function code ...
} 