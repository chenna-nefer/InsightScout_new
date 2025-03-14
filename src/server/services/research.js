// Import existing research functions from your current server.js
import xlsx from 'xlsx';
import { parse } from 'csv-parse';
import fs from 'fs';
import axios from 'axios';
import Exa from 'exa-js';
import { Groq } from 'groq-sdk';
import dotenv from 'dotenv';

dotenv.config();

// Initialize API clients
const exa = new Exa(process.env.EXA_API_KEY);
const groqClient = new Groq();

const processedCompanies = new Set();

export async function getCompanyNames(filePath) {
  const extension = filePath.split('.').pop().toLowerCase();
  
  if (extension === 'xlsx') {
    return getCompaniesFromExcel(filePath);
  } else if (extension === 'csv') {
    return getCompaniesFromCSV(filePath);
  }
  
  throw new Error('Unsupported file format');
}

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
    
    // Log the first row to see available columns
    console.log('Excel columns:', Object.keys(data[0] || {}));
    console.log('First row data:', data[0]);
    
    // Try different possible column names
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
      // Try each possible column name
      for (const colName of possibleColumnNames) {
        if (row[colName]) {
          const companyName = row[colName].toString().trim();
          if (companyName && companyName !== 'undefined') {
            return companyName;
          }
        }
      }
      
      // If no match found, try the first column
      const firstValue = Object.values(row)[0];
      if (firstValue) {
        const companyName = firstValue.toString().trim();
        if (companyName && companyName !== 'undefined') {
          return companyName;
        }
      }
      
      return null;
    }).filter(Boolean); // Remove null/undefined values

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
        // Try different possible column names
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
        // If no match found, try the first column
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

export async function researchCompany(companyName) {
  console.log(`\n=== Researching Company: ${companyName} ===`);
  
  try {
    // Skip if already processed
    if (processedCompanies.has(companyName)) {
      console.log('Company already processed, skipping');
      return {
        companyName,
        foundersData: []
      };
    }

    // 1. Get founder details from Perplexity
    const { founderInfo } = await getFounderDetails(companyName);
    if (!founderInfo) {
      console.log('❌ No founder information found');
      processedCompanies.add(companyName);
      return {
        companyName,
        foundersData: []
      };
    }

    // 2. Extract founder names and create structured data
    const founders = extractStructuredFounderData(founderInfo);
    if (!founders || founders.length === 0) {
      console.log('❌ No valid founder data extracted');
      processedCompanies.add(companyName);
      return {
        companyName,
        foundersData: []
      };
    }

    // 3. Process each founder
    const foundersData = [];
    const processedFounders = new Set(); // Track processed founders by name
    
    for (const founder of founders) {
      // Skip if we've already processed this founder
      if (processedFounders.has(founder.name)) {
        console.log(`Skipping duplicate founder: ${founder.name}`);
        continue;
      }
      
      console.log(`\n👤 Processing founder: ${founder.name}`);
      processedFounders.add(founder.name);
      
      // Find LinkedIn profile
      const linkedinUrl = await getLinkedInProfile(founder.name, companyName);
      
      // Initialize founder data
      const founderData = {
        name: founder.name,
        role: founder.role || 'Founder', // Use role from structured data
        linkedinUrl: linkedinUrl || '',
        email: '',
        phone: ''
      };

      // If we have a LinkedIn URL, try to get email and phone
      if (linkedinUrl) {
        console.log('✓ Found LinkedIn profile');
        
        // Get email
        try {
          const emailResponse = await axios({
            method: 'post',
            url: 'https://api.prospeo.io/social-url-enrichment',
            headers: {
              'Content-Type': 'application/json',
              'X-KEY': process.env.PROSPEO_API_KEY
            },
            data: { url: linkedinUrl }
          });

          if (emailResponse.data?.error === false && emailResponse.data?.response?.email?.email) {
            founderData.email = emailResponse.data.response.email.email;
          }
        } catch (emailError) {
          console.error('Error getting email:', emailError.message);
        }

        // Get phone
        try {
          const phoneResponse = await axios({
            method: 'post',
            url: 'https://api.prospeo.io/mobile-finder',
            headers: {
              'Content-Type': 'application/json',
              'X-KEY': process.env.PROSPEO_API_KEY
            },
            data: { url: linkedinUrl }
          });

          if (phoneResponse.data?.error === false && phoneResponse.data?.response?.raw_format) {
            founderData.phone = phoneResponse.data.response.raw_format;
          }
        } catch (phoneError) {
          console.error('Error getting phone:', phoneError.message);
        }
      } else {
        console.log('⚠️ No LinkedIn profile found');
      }

      foundersData.push(founderData);
    }

    // Mark company as processed
    processedCompanies.add(companyName);

    return {
      companyName,
      foundersData
    };

  } catch (error) {
    console.error('Error researching company:', error.message);
    processedCompanies.add(companyName);
    return {
      companyName,
      foundersData: []
    };
  }
}

async function getFounderDetails(companyName) {
  console.log('\n=== Getting Founder Details for:', companyName, '===');
  
  try {
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
            content: 'You are a helpful assistant that provides accurate information about company founders and CEOs. Return ONLY verified founder/CEO names in a structured format. Each name must be on a new line with their role.'
          },
          {
            role: 'user',
            content: `Find the current founder(s) or CEO of ${companyName}. Format each person exactly like this:
Founder: FirstName LastName
CEO: FirstName LastName

Only include people where you are confident of both their role and full name. If no verified information is found, respond with "No verified founder information found."`
          }
        ],
        max_tokens: 150,
        temperature: 0.1,
        top_p: 0.9
      }
    });

    if (response.data?.choices?.[0]?.message?.content) {
      const founderInfo = response.data.choices[0].message.content.trim();
      console.log('Raw founder information:', founderInfo);
      
      // If explicitly states no verified information
      if (founderInfo.toLowerCase().includes('no verified founder')) {
        console.log('No verified founder information found');
        return { founderInfo: '', citations: [] };
      }

      // Process each line
      const lines = founderInfo.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
      
      // Validate each line matches our format
      const validLines = lines.filter(line => {
        const match = line.match(/^(Founder|CEO):\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)$/);
        if (match) {
          const [, role, name] = match;
          // Ensure name has at least two parts and follows capitalization
          const nameParts = name.split(/\s+/);
          return nameParts.length >= 2 && 
                 nameParts.every(part => /^[A-Z][a-z]+$/.test(part));
        }
        return false;
      });

      if (validLines.length > 0) {
        console.log('Validated founder information:', validLines.join('\n'));
        return {
          founderInfo: validLines.join('\n'),
          citations: response.data.citations || []
        };
      }
      
      console.log('No valid founder information found after validation');
      return { founderInfo: '', citations: [] };
    }

    console.log('No founder information in response');
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

function extractStructuredFounderData(founderInfo) {
  console.log('\n=== Extracting Structured Founder Data ===');
  console.log('Raw founder info:', founderInfo);

  try {
    if (!founderInfo) {
      console.log('No founder info to extract');
      return [];
    }

    // Split by newlines and process each line
    const lines = founderInfo.split('\n').map(line => line.trim()).filter(Boolean);
    
    // Use a Map to track unique founders by name
    const foundersMap = new Map();
    
    for (const line of lines) {
      // Extract role and name from the line
      const match = line.match(/^(Founder|CEO):\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)$/);
      if (match) {
        const [, role, name] = match;
        
        // Skip if we already have this person (avoid duplicates)
        if (!foundersMap.has(name)) {
          foundersMap.set(name, {
            name,
            role,
            linkedinUrl: null,
            email: null,
            phone: null
          });
        }
      }
    }

    // Convert Map to array
    const founders = Array.from(foundersMap.values());
    console.log('Extracted founders:', founders);
    return founders;

  } catch (error) {
    console.error('Error extracting founder data:', error.message);
    return [];
  }
}

async function getLinkedInProfile(founderName, companyName) {
  console.log('\n=== Getting LinkedIn Profile ===');
  console.log('Founder:', founderName);
  console.log('Company:', companyName);
  
  try {
    if (!founderName || !companyName) {
      console.log('Skipping - Missing founder or company name');
      return null;
    }

    // Clean up the founder name and company name
    const cleanFounderName = founderName.replace(/[^\w\s]/g, '').trim();
    const cleanCompanyName = companyName.replace(/[^\w\s]/g, '').trim();
    
    // Get first and last name
    const nameParts = cleanFounderName.split(/\s+/);
    if (nameParts.length < 2) {
      console.log('Invalid founder name format');
      return null;
    }
    
    const firstName = nameParts[0];
    const lastName = nameParts[nameParts.length - 1];
    
    // Create search queries - try different combinations
    const searchQueries = [
      `site:linkedin.com/in/ "${firstName} ${lastName}" "${cleanCompanyName}"`,
      `site:linkedin.com/in/ "${cleanFounderName}" founder OR ceo "${cleanCompanyName}"`,
      `site:linkedin.com/in/ "${firstName} ${lastName}" founder OR ceo`
    ];

    for (const searchQuery of searchQueries) {
      console.log('Trying search query:', searchQuery);
      
      const response = await axios({
        method: 'post',
        url: 'https://api.exa.ai/search',
        headers: {
          'Authorization': `Bearer ${process.env.EXA_API_KEY}`,
          'Content-Type': 'application/json'
        },
        data: {
          query: searchQuery,
          num_results: 3,
          type: 'keyword'
        }
      });

      if (response.data?.results?.length > 0) {
        // Find the most relevant LinkedIn profile URL
        for (const result of response.data.results) {
          if (result.url.includes('linkedin.com/in/')) {
            const profileUrl = result.url.split('?')[0]; // Remove URL parameters
            
            // Verify the profile matches our criteria
            const urlName = profileUrl.split('/in/')[1].toLowerCase();
            const firstNameLower = firstName.toLowerCase();
            const lastNameLower = lastName.toLowerCase();
            
            if (urlName.includes(firstNameLower) || urlName.includes(lastNameLower)) {
              console.log('Found LinkedIn URL:', profileUrl);
              return profileUrl;
            }
          }
        }
      }
    }

    console.log('No matching LinkedIn profile found');
    return null;

  } catch (error) {
    console.error('Error getting LinkedIn profile:', error.message);
    if (error.response) {
      console.error('API Error:', {
        status: error.response.status,
        data: error.response.data
      });
    }
    return null;
  }
}

export async function saveToExcel(results) {
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
    
    return flatResults;
  } catch (error) {
    console.error('❌ Error saving to Excel:', error);
    throw error;
  }
} 