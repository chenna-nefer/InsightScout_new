import axios from 'axios';
import xlsx from 'xlsx';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import OpenAI from 'openai';
import Exa from 'exa-js';
import { google } from 'googleapis';
import path from 'path';
import { Groq } from "groq-sdk";

// Initialize dotenv
dotenv.config();

// Get current file directory (ES modules don't have __dirname)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// API Configuration
const EXA_API_KEY = process.env.EXA_API_KEY;
const PROSPEO_API_KEY = process.env.PROSPEO_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const EXCEL_FILE_PATH = './companies.xlsx';
const OUTPUT_FILE_PATH = './companies_enriched.xlsx';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Initialize Exa client
const exa = new Exa(EXA_API_KEY);

// Add this at the top with other imports
const SPREADSHEET_ID = '1L9nEiBJdD1euie-lqtidWlt-fbKQIuDwMgVuYw28c60';
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');

// Add Perplexity API configuration
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;

// Add Groq client configuration
const groqClient = new Groq();

// Add this new function to handle Google Sheets authentication and data fetching
async function getGoogleSheetsData() {
  try {
    console.log('Initializing Google Sheets connection...');
    
    const auth = new google.auth.GoogleAuth({
      keyFile: CREDENTIALS_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const sheets = google.sheets({ version: 'v4', auth });
    
    console.log('Fetching data from sheet...');
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A1:H50', // Adjust if you need more rows
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      throw new Error('No data found in spreadsheet');
    }

    // Convert rows to objects
    const headers = rows[0];
    const companies = rows.slice(1).map(row => {
      return headers.reduce((obj, header, index) => {
        obj[header.trim()] = row[index] || '';
        return obj;
      }, {});
    });

    console.log(`Successfully loaded ${companies.length} companies`);
    return companies;

  } catch (error) {
    console.error('Error accessing Google Sheets:', error);
    throw error;
  }
}

// // Modified update function to handle errors better
// async function updateGoogleSheets(rowIndex, companyName, phoneNumber) {
//   try {
//     console.log(`\n=== Updating Sheet for ${companyName} ===`);
//     console.log(`Row Index: ${rowIndex + 2}`); // +2 because of 0-based index and header
//     console.log(`Phone Number: ${phoneNumber}`);
    
//     const auth = new google.auth.GoogleAuth({
//       keyFile: CREDENTIALS_PATH,
//       scopes: ['https://www.googleapis.com/auth/spreadsheets']
//     });

//     const sheets = google.sheets({ version: 'v4', auth });

//     // First verify we're updating the correct company
//     const verifyResponse = await sheets.spreadsheets.values.get({
//       spreadsheetId: SPREADSHEET_ID,
//       range: `Sheet1!A${rowIndex + 2}`, // Get company name from first column
//     });

//     const cellCompanyName = verifyResponse.data.values?.[0]?.[0];
    
//     if (cellCompanyName !== companyName) {
//       throw new Error(`Company name mismatch! Sheet: ${cellCompanyName}, Processing: ${companyName}`);
//     }

//     console.log('Verified correct company row ✓');
    
//     // Now update the phone number
//     await sheets.spreadsheets.values.update({
//       spreadsheetId: SPREADSHEET_ID,
//       range: `Sheet1!D${rowIndex + 2}`, // Phone number column
//       valueInputOption: 'RAW',
//       requestBody: {
//         values: [[phoneNumber]]
//       }
//     });

//     console.log(`Successfully updated phone number for ${companyName}`);
    
//     // Verify the update
//     const verifyUpdate = await sheets.spreadsheets.values.get({
//       spreadsheetId: SPREADSHEET_ID,
//       range: `Sheet1!D${rowIndex + 2}`,
//     });

//     const updatedPhoneNumber = verifyUpdate.data.values?.[0]?.[0];
//     if (updatedPhoneNumber !== phoneNumber) {
//       throw new Error(`Phone number update verification failed! Expected: ${phoneNumber}, Got: ${updatedPhoneNumber}`);
//     }

//     console.log('Verified phone number update ✓');

//   } catch (error) {
//     console.error('Error updating Google Sheets:', error.message);
//     throw error;
//   }
// }



async function getMobileNumber(linkedinUrl) {
  console.log('\n=== Getting Mobile Number ===');
  console.log('LinkedIn URL:', linkedinUrl);
  
  try {
    if (!linkedinUrl || !linkedinUrl.includes('linkedin.com/in/')) {
      console.log('Skipping - Invalid LinkedIn URL');
      return '';
    }

    const response = await axios({
      method: 'post',
      url: 'https://api.prospeo.io/mobile-finder',
      headers: {
        'Content-Type': 'application/json',
        'X-KEY': PROSPEO_API_KEY
      },
      data: { url: linkedinUrl }
    });

    console.log('API Response:', JSON.stringify(response.data, null, 2));
    
    // Check if we have a valid response with raw_format
    if (response.data?.error === false && response.data?.response?.raw_format) {
      const mobileNumber = response.data.response.raw_format;
      console.log('Extracted mobile number:', mobileNumber);
      return mobileNumber;
    }

    console.log('No mobile number in response');
    return '';

  } catch (error) {
    console.error('Error getting mobile number:', error.message);
    if (error.response) {
      console.error('API Error:', {
        status: error.response.status,
        data: error.response.data
      });
    }
    return '';
  }
}

// Add function to check if mobile number exists
async function checkExistingMobileNumber(rowIndex) {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: CREDENTIALS_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const sheets = google.sheets({ version: 'v4', auth });
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `Sheet1!D${rowIndex + 2}`, // Phone number column
    });

    const existingNumber = response.data.values?.[0]?.[0];
    return existingNumber && existingNumber.trim() !== '';
  } catch (error) {
    console.error('Error checking existing number:', error);
    return false;
  }
}

async function copyGoogleSheetsToExcel() {
  try {
    console.log('=== Starting Google Sheets to Excel Copy ===');
    
    // 1. Get data from Google Sheets
    const auth = new google.auth.GoogleAuth({
      keyFile: CREDENTIALS_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const sheets = google.sheets({ version: 'v4', auth });
    
    console.log('Fetching data from Google Sheets...');
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A:H', // Get all rows from A to H
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      throw new Error('No data found in Google Sheets');
    }

    console.log(`Found ${rows.length - 1} companies in Google Sheets`);

    // 2. Create Excel Workbook
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet(rows);

    // 3. Add the worksheet to the workbook
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Companies');

    // 4. Save the workbook
    xlsx.writeFile(workbook, 'companydetails.xlsx');

    console.log('✓ Successfully copied data to companydetails.xlsx');
    
    // Return the data for verification
    return {
      totalRows: rows.length,
      headers: rows[0],
      sampleData: rows.slice(1, 3) // First two companies for verification
    };

  } catch (error) {
    console.error('Error copying data to Excel:', error);
    throw error;
  }
}

// Add this function to find email using Prospeo's social-url-enrichment endpoint
async function findEmailWithProspeo(linkedinUrl, companyName) {
  console.log('\n=== Finding Email for company:', companyName, '===');
  console.log('LinkedIn URL:', linkedinUrl);
  
  try {
    if (!linkedinUrl || !linkedinUrl.includes('linkedin.com/in/')) {
      console.log('Skipping - Invalid LinkedIn URL');
      return '';
    }

    const response = await axios({
      method: 'post',
      url: 'https://api.prospeo.io/social-url-enrichment',
      headers: {
        'Content-Type': 'application/json',
        'X-KEY': PROSPEO_API_KEY
      },
      data: { url: linkedinUrl }
    });

    console.log('API Response Status:', response.status);
    
    if (response.data?.error === false && response.data?.response?.email?.email) {
      const email = response.data.response.email.email;
      const emailStatus = response.data.response.email.email_status;
      
      console.log('Found email:', email);
      console.log('Email status:', emailStatus);
      
      // Accept VALID emails as well
      if (emailStatus === 'VERIFIED' || emailStatus === 'ACCEPT_ALL' || emailStatus === 'VALID') {
        return email;
      }
      console.log('Skipping - Email not verified');
      return '';
    }

    console.log('No valid email found in response');
    return '';

  } catch (error) {
    if (error.response?.data?.message === 'INSUFFICIENT_CREDITS') {
      console.error('❌ Out of Prospeo credits - stopping process');
      throw error;
    }
    console.error('Error finding email:', error.message);
    if (error.response) {
      console.error('API Error:', {
        status: error.response.status,
        data: error.response.data
      });
    }
    return '';
  }
}

// Add function to check if email exists
async function checkExistingEmail(rowIndex) {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: CREDENTIALS_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const sheets = google.sheets({ version: 'v4', auth });
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `Sheet1!C${rowIndex + 2}`, // Email column (C)
    });

    const existingEmail = response.data.values?.[0]?.[0];
    return existingEmail && existingEmail.trim() !== '';
  } catch (error) {
    console.error('Error checking existing email:', error);
    return false;
  }
}

// Add function to get founder details using Perplexity API
async function getFounderDetails(companyName) {
  console.log('\n=== Getting Founder Details for:', companyName, '===');
  
  try {
    const response = await axios({
      method: 'post',
      url: 'https://api.perplexity.ai/chat/completions',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      data: {
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that provides accurate information about company founders. Please be precise and concise.'
          },
          {
            role: 'user',
            content: `Who is the founder of ${companyName}? Please provide their name and brief background.`
          }
        ],
        max_tokens: 150,
        temperature: 0.2,
        top_p: 0.9
      }
    });

    if (response.data?.choices?.[0]?.message?.content) {
      const founderInfo = response.data.choices[0].message.content;
      console.log('Found founder information:', founderInfo);
      return {
        founderInfo,
        citations: response.data.citations || []
      };
    }

    console.log('No founder information found');
    return { founderInfo: '', citations: [] };

  } catch (error) {
    console.error('Error getting founder details:', error.message);
    if (error.response) {
      console.error('API Error:', {
        status: error.response.status,
        data: error.response.data
      });
    }
    return { founderInfo: '', citations: [] };
  }
}

// Helper function to clean founder information
function cleanFounderInfo(founderInfo) {
  // Remove markdown formatting and citations
  return founderInfo
    .replace(/\*\*/g, '') // Remove bold markdown
    .replace(/\[[\d\]]/g, '') // Remove citation numbers [1], [2], etc.
    .split('\n')[0] // Take only the first paragraph
    .trim();
}

// Modified function to extract founder name from Perplexity response
function extractFounderName(founderInfo) {
  // Look for patterns like "founder is" or "founders are"
  const founderMatch = founderInfo.match(/founder[s]?\s+(?:is|are)\s+([^\.]+)/i);
  if (founderMatch) {
    return founderMatch[1].trim();
  }
  return '';
}

// Fix Exa search function to use correct API
async function getLinkedInProfile(founderName, companyName) {
  console.log('\n=== Finding LinkedIn Profile ===');
  console.log('Searching for:', founderName, 'from', companyName);

  try {
    // Skip if no founder name
    if (!founderName) {
      console.log('Skipping - No founder name available');
      return '';
    }

    const searchQuery = `site:linkedin.com/ ${founderName} ${companyName}`;
    
    // Use correct Exa search method
    const results = await exa.search(searchQuery, {
      numResults: 1,
      useAutoprompt: false,
      type: 'keyword'
    });

    if (results && results.results && results.results.length > 0) {
      const linkedinUrl = results.results[0].url;
      // Verify it's actually a LinkedIn profile URL
      if (linkedinUrl.includes('linkedin.com/in/')) {
        console.log('Found LinkedIn URL:', linkedinUrl);
        return linkedinUrl;
      }
    }

    console.log('No LinkedIn profile found');
    return '';
    
  } catch (error) {
    console.error('Error finding LinkedIn profile:', error);
    return '';
  }
}

// Helper function to read company names from Google Sheets
async function getCompanyNames() {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: CREDENTIALS_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });

    const sheets = google.sheets({ version: 'v4', auth });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A2:A', // Only company names column, skip header
    });

    return response.data.values?.map(row => row[0]) || [];
  } catch (error) {
    console.error('Error reading company names:', error);
    throw error;
  }
}

// Helper to verify founder information using multiple sources
async function verifyFounder(companyName, potentialFounder) {
  try {
    let confidence = 0;
    let sources = [];

    // 1. Search company website
    try {
      const websiteResults = await exa.search(
        `${companyName} ${potentialFounder} founder OR CEO`,
        { 
          numResults: 3,
          useAutoprompt: false,
          type: 'keyword'
        }
      );

      if (websiteResults?.results) {
        websiteResults.results.forEach(result => {
          // Safely check if result and result.text exist
          if (result?.text) {
            const text = result.text.toLowerCase();
            const url = result.url;
            if (text.includes(potentialFounder.toLowerCase()) &&
                (text.includes('founder') || text.includes('ceo'))) {
              confidence += 0.4;
              sources.push(url);
            }
          }
        });
      }
    } catch (error) {
      console.error('Website search error:', error.message);
    }

    // 2. Search news articles with better error handling
    try {
      const newsResults = await exa.search(
        `${companyName} ${potentialFounder} founder OR CEO site:linkedin.com OR site:crunchbase.com`,
        { 
          numResults: 3,
          useAutoprompt: false,
          type: 'keyword'
        }
      );

      if (newsResults?.results) {
        newsResults.results.forEach(result => {
          if (result?.text) {
            const text = result.text.toLowerCase();
            const url = result.url;
            if (text.includes(potentialFounder.toLowerCase()) &&
                (text.includes('founder') || text.includes('ceo'))) {
              confidence += 0.2;
              sources.push(url);
            }
          }
        });
      }
    } catch (error) {
      console.error('News search error:', error.message);
    }

    return {
      isVerified: confidence >= 0.6,
      confidence,
      sources: [...new Set(sources)] // Remove duplicates
    };
  } catch (error) {
    console.error('Error in verifyFounder:', error);
    return { isVerified: false, confidence: 0, sources: [] };
  }
}

// Helper to verify LinkedIn profile authenticity
async function verifyLinkedInProfile(url, founderName, companyName) {
  try {
    const response = await exa.search(
      `${founderName} ${companyName} site:linkedin.com/in/`,
      { numResults: 1 }
    );

    if (!response?.results?.[0]) return false;

    const result = response.results[0];
    const profileText = result.text.toLowerCase();
    const nameMatch = profileText.includes(founderName.toLowerCase());
    const companyMatch = profileText.includes(companyName.toLowerCase());
    const roleMatch = profileText.includes('founder') || profileText.includes('ceo');

    return nameMatch && companyMatch && roleMatch;
  } catch (error) {
    console.error('Error verifying LinkedIn profile:', error);
    return false;
  }
}

// Modified function to get structured founder data using Groq
async function extractStructuredFounderData(perplexityResponse) {
  try {
    const prompt = `
    Extract founder/CEO information from the following text:
    ${perplexityResponse}`;

    const completion = await groqClient.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: "You are a precise data extractor. Extract founder information and return it as a JSON object."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.1,
      max_tokens: 500,
      response_format: { 
        type: "json_object",
        schema: {
          type: "object",
          properties: {
            founders: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  role: { type: "string" },
                  background: { type: "string" }
                },
                required: ["name"]
              }
            },
            company_info: {
              type: "object",
              properties: {
                founding_year: { type: "string" },
                location: { type: "string" }
              }
            }
          },
          required: ["founders"]
        }
      }
    });

    // The response should already be JSON
    const jsonResponse = completion.choices[0].message.content;
    console.log('✓ Successfully extracted structured data');
    return JSON.parse(jsonResponse);

  } catch (error) {
    console.error('Error extracting structured data:', error);
    
    // Fallback: Try to extract basic information from Perplexity response
    try {
      const nameMatches = perplexityResponse.match(/\*\*([^*]+)\*\*/g);
      if (nameMatches) {
        const founders = nameMatches.map(match => ({
          name: match.replace(/\*\*/g, '').trim(),
          role: "founder",
          background: ""
        }));
        
        return {
          founders,
          company_info: {
            founding_year: "",
            location: ""
          }
        };
      }
    } catch (fallbackError) {
      console.error('Fallback extraction failed:', fallbackError);
    }
    return null;
  }
}

// Modified research function
async function researchCompany(companyName) {
  console.log(`\n🔍 Researching: ${companyName}`);
  
  try {
    // 1. Get initial founder info from Perplexity
    const { founderInfo } = await getFounderDetails(companyName);
    console.log('✓ Retrieved company information');

    // 2. Extract structured data using Groq
    const structuredData = await extractStructuredFounderData(founderInfo);
    if (!structuredData?.founders?.length) {
      console.log('❌ No valid founder data extracted');
      return null;
    }

    // 3. Process each founder
    const foundersData = [];
    for (const founder of structuredData.founders) {
      console.log(`\n👤 Processing founder: ${founder.name}`);
      
      // Find LinkedIn profile
      const linkedinUrl = await getLinkedInProfile(founder.name, companyName);
      if (linkedinUrl) {
        console.log('✓ Found LinkedIn profile');
        foundersData.push({
          name: founder.name,
          role: founder.role,
          background: founder.background,
          linkedinUrl: linkedinUrl
        });
      } else {
        console.log('⚠️ No LinkedIn profile found');
        foundersData.push({
          name: founder.name,
          role: founder.role,
          background: founder.background,
          linkedinUrl: ''
        });
      }
    }

    return {
      companyName,
      foundersData,
      companyInfo: structuredData.company_info
    };

  } catch (error) {
    console.error(`❌ Error researching ${companyName}:`, error);
    return null;
  }
}

// Modified save to Excel function
function saveToExcel(results) {
  try {
    // Flatten results for Excel
    const flatResults = results.flatMap(result => {
      if (!result?.foundersData) return [];
      return result.foundersData.map(founder => ({
        'Company Name': result.companyName,
        'Founder Name': founder.name,
        'Role': founder.role,
        'Background': founder.background,
        'LinkedIn URL': founder.linkedinUrl,
        'Founded Year': result.companyInfo?.founding_year || '',
        'Location': result.companyInfo?.location || ''
      }));
    });

    if (flatResults.length === 0) {
      console.log('❌ No results to save');
      return;
    }

    // Create workbook and worksheet
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.json_to_sheet(flatResults);

    // Add custom column widths
    worksheet['!cols'] = [
      { wch: 30 }, // Company Name
      { wch: 25 }, // Founder Name
      { wch: 15 }, // Role
      { wch: 50 }, // Background
      { wch: 50 }, // LinkedIn URL
      { wch: 15 }, // Founded Year
      { wch: 20 }  // Location
    ];

    // Add worksheet to workbook
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Companies');

    // Save workbook
    xlsx.writeFile(workbook, 'company_details.xlsx');
    console.log('\n✅ Results saved to company_details.xlsx');
    
    // Log summary
    console.log('\n📊 Results Summary:');
    console.log(`Total companies processed: ${results.length}`);
    console.log(`Total founders found: ${flatResults.length}`);
    console.log(`LinkedIn profiles found: ${flatResults.filter(r => r['LinkedIn URL']).length}`);
  } catch (error) {
    console.error('❌ Error saving to Excel:', error);
  }
}

// Modified main function
async function main() {
  try {
    console.log('🚀 Starting Company Research Process');

    // 1. Get company names
    const companies = await getCompanyNames();
    console.log(`📋 Found ${companies.length} companies to research\n`);

    // 2. Research each company in reverse order
    const results = [];
    const reversedCompanies = [...companies].reverse();

    for (let i = 0; i < reversedCompanies.length; i++) {
      const companyName = reversedCompanies[i];
      console.log(`\n📌 Processing ${reversedCompanies.length - i}/${reversedCompanies.length}: ${companyName}`);
      
      try {
        const result = await researchCompany(companyName);
        if (result) {
          results.push(result);
          console.log('✅ Successfully processed');
        }
      } catch (error) {
        console.error(`❌ Failed to process ${companyName}:`, error.message);
        continue;
      }

      // Add delay between requests
      if (i < reversedCompanies.length - 1) {
        console.log('⏳ Waiting 3 seconds...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    // 3. Save results
    if (results.length > 0) {
      saveToExcel(results.reverse());
    } else {
      console.log('❌ No results to save');
    }

  } catch (error) {
    console.error('❌ Error in main process:', error);
  }
}

// Run the script
main().catch(console.error);