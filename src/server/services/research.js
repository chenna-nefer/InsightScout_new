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
        console.log(`Getting data for company: ${companyName}`);
        const response = await axios({
            method: 'post',
            url: 'https://api.perplexity.ai/chat/completions',
            headers: {
                'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
                'Content-Type': 'application/json'
            },
            data: {
                model: 'sonar',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a research assistant focused on finding verified company information. Return only factual data about the specific company asked.'
                    },
                    {
                        role: 'user',
                        content: `Find verified information about the company "${companyName}". Focus only on:
1. Full company name
2. Official company website
3. Names of founders and/or CEO with their roles
4. Year founded (if available)

Do not include LinkedIn URLs or contact information. Only include information you are confident is accurate.`
                    }
                ],
                max_tokens: 1024,
                temperature: 0.1
            }
        });

        console.log('Perplexity Raw Response:', response.data?.choices?.[0]?.message?.content);
        return response.data?.choices?.[0]?.message?.content;

    } catch (error) {
        console.error('Error getting company data:', error.message);
        return null;
    }
}

// 2. Extract structured data using Groq
async function extractFounderData(rawData) {
    if (!rawData) return { founders: [], website: '' };

    try {
        const completion = await groqClient.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: "Extract and structure company information from the given text. Return only in JSON format."
                },
                {
                    role: "user",
                    content: `Extract the following from this text and return as JSON:
${rawData}

Return in this exact format:
{
    "companyName": "full company name",
    "website": "company website URL",
    "yearFounded": "year if mentioned or null",
    "founders": [
        {
            "name": "full name",
            "role": "current role"
        }
    ]
}`
                }
            ],
            model: "mixtral-8x7b-32768",
            temperature: 0.1,
            max_tokens: 1024
        });

        const result = JSON.parse(completion.choices[0].message.content);
        console.log('Structured Data:', result);
        return result;
    } catch (error) {
        console.error('Error extracting founder data:', error);
        return { companyName: '', website: '', yearFounded: null, founders: [] };
    }
}

// 3. Find LinkedIn profiles using Exa
async function findLinkedInProfile(founderName, companyName) {
    console.log(`\n=== Finding LinkedIn Profile for ${founderName} ===`);
    
    try {
        if (!founderName || !companyName) return null;

        const query = `site:linkedin.com/in/ "${founderName}" "${companyName}" (founder OR ceo OR chief)`;
        console.log('Search query:', query);

        const response = await exa.search(query, {
            numResults: 3,
            useAutoprompt: false
        });

        if (response?.results) {
            const linkedInResult = response.results.find(result => {
                const url = result.url || '';
                return url.includes('linkedin.com/in/') && !url.includes('/pub/');
            });

            if (linkedInResult?.url) {
                const cleanUrl = linkedInResult.url.split('?')[0];
                console.log('Found LinkedIn URL:', cleanUrl);
                return cleanUrl;
            }
        }

        console.log('No LinkedIn profile found');
        return null;

    } catch (error) {
        console.error('Error in LinkedIn search:', error.message);
        return null;
    }
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
        // Get raw company data from Perplexity
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

        // Extract structured data using Groq
        const { founders, website, yearFounded } = await extractFounderData(rawData);
        
        // Process each founder
        const foundersData = [];
        if (founders && Array.isArray(founders) && founders.length > 0) {
            for (const founder of founders) {
                if (!founder?.name || founder.name === 'Not mentioned') continue;

                console.log(`\n👤 Processing founder: ${founder.name}`);
                
                // Find LinkedIn profile using Exa
                const linkedinUrl = await findLinkedInProfile(founder.name, companyName);
                
                // Get contact details if LinkedIn profile is found
                const [emailData, phoneData] = await Promise.all([
                    getFounderEmail(linkedinUrl || ''),
                    getFounderPhone(linkedinUrl || '')
                ]);

                foundersData.push({
                    name: founder.name,
                    role: founder.role || 'Not Found',
                    linkedinUrl: linkedinUrl || 'Not Found',
                    email: emailData.email || 'Not Found',
                    phone: phoneData.phone || 'Not Found'
                });
            }
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