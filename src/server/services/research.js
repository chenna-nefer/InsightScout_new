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
    let { founderInfo } = await getFounderDetails(companyName);
    
    // 2. If no founder info found, try Crunchbase
    if (!founderInfo) {
      console.log('No founder info from Perplexity, trying Crunchbase...');
      const crunchbaseData = await searchCrunchbase(companyName);
      
      if (crunchbaseData) {
        // Use Perplexity to extract structured data from Crunchbase content
        const crunchbaseResponse = await axios({
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
                content: 'Extract founder and company information from the given text in the specified format.'
              },
              {
                role: 'user',
                content: `Extract founder and company information from this Crunchbase data and format it as specified:\n${crunchbaseData}`
              }
            ],
            max_tokens: 250,
            temperature: 0.1
          }
        });

        if (crunchbaseResponse.data?.choices?.[0]?.message?.content) {
          founderInfo = crunchbaseResponse.data.choices[0].message.content.trim();
        }
      }
    }

    // 3. If still no founder info, try company website
    if (!founderInfo) {
      console.log('No founder info from Crunchbase, trying company website...');
      const websiteInfo = await getCompanyWebsiteInfo(companyName);
      
      if (websiteInfo) {
        // Use Perplexity to extract structured data from website content
        const websiteResponse = await axios({
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
                content: 'Extract founder and company information from the given text in the specified format.'
              },
              {
                role: 'user',
                content: `Extract founder and company information from this website content and format it as specified:\n${websiteInfo.content}`
              }
            ],
            max_tokens: 250,
            temperature: 0.1
          }
        });

        if (websiteResponse.data?.choices?.[0]?.message?.content) {
          founderInfo = websiteResponse.data.choices[0].message.content.trim();
        }
      }
    }

    if (!founderInfo) {
      console.log('❌ No founder information found from any source');
      processedCompanies.add(companyName);
      return {
        companyName,
        foundersData: []
      };
    }

    // Extract structured data and continue with existing logic
    const { founders, company_info } = extractStructuredFounderData(founderInfo);
    if (!founders || founders.length === 0) {
      console.log('❌ No valid founder data extracted');
      processedCompanies.add(companyName);
      return {
        companyName,
        foundersData: []
      };
    }

    // Process each founder
    const foundersData = [];
    const processedFounders = new Set();
    
    for (const founder of founders) {
      if (processedFounders.has(founder.name)) {
        console.log(`Skipping duplicate founder: ${founder.name}`);
        continue;
      }
      
      console.log(`\n👤 Processing founder: ${founder.name}`);
      processedFounders.add(founder.name);
      
      // Find LinkedIn profile
      const linkedinUrl = await getLinkedInProfile(founder.name, companyName);
      
      const founderData = {
        name: founder.name,
        role: founder.role || 'Founder',
        background: founder.background || '',
        linkedinUrl: linkedinUrl || '',
        email: '',
        phone: ''
      };

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
      foundersData,
      companyInfo: company_info
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
            content: `You are a precise company research assistant that provides verified information about company founders and executives. Focus on finding:
1. Current founders and co-founders
2. Current CEO if different from founders
3. Year company was founded
4. Company headquarters location
Return information in this exact format:
Founder: FirstName LastName (Role, Year joined)
Co-Founder: FirstName LastName (Role, Year joined)
CEO: FirstName LastName (Since Year)
Founded: Year
Location: City, Country

Only include verified information from reliable sources. If information cannot be verified, respond with "No verified information found."`
          },
          {
            role: 'user',
            content: `Research ${companyName} and provide founder, CEO, and company information in the specified format. Include only verified information from reliable sources.`
          }
        ],
        max_tokens: 250,
        temperature: 0.1,
        top_p: 0.9
      }
    });

    if (response.data?.choices?.[0]?.message?.content) {
      const founderInfo = response.data.choices[0].message.content.trim();
      console.log('Raw founder information:', founderInfo);
      
      // If explicitly states no verified information
      if (founderInfo.toLowerCase().includes('no verified')) {
        console.log('No verified founder information found');
        return { founderInfo: '', citations: [] };
      }

      // Process and validate the information
      const lines = founderInfo.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
      
      // Validate each line matches our format
      const validLines = lines.filter(line => {
        const roleMatch = line.match(/^(Founder|Co-Founder|CEO|Founded|Location):/);
        if (!roleMatch) return false;

        if (roleMatch[1] === 'Founded' || roleMatch[1] === 'Location') return true;

        const nameMatch = line.match(/^(?:Founder|Co-Founder|CEO):\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/);
        if (!nameMatch) return false;

        const nameParts = nameMatch[1].split(/\s+/);
        return nameParts.length >= 2 && 
               nameParts.every(part => /^[A-Z][a-z]+$/.test(part));
      });

      if (validLines.length > 0) {
        console.log('Validated information:', validLines.join('\n'));
        return {
          founderInfo: validLines.join('\n'),
          citations: response.data.citations || []
        };
      }
      
      console.log('No valid information found after validation');
      return { founderInfo: '', citations: [] };
    }

    console.log('No information in response');
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
      return {
        founders: [],
        company_info: {
          founding_year: '',
          location: ''
        }
      };
    }

    const lines = founderInfo.split('\n').map(line => line.trim()).filter(Boolean);
    const foundersMap = new Map();
    let companyInfo = {
      founding_year: '',
      location: ''
    };
    
    for (const line of lines) {
      if (line.startsWith('Founded:')) {
        companyInfo.founding_year = line.replace('Founded:', '').trim();
        continue;
      }
      
      if (line.startsWith('Location:')) {
        companyInfo.location = line.replace('Location:', '').trim();
        continue;
      }
      
      const match = line.match(/^(Founder|Co-Founder|CEO):\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)(?:\s+\((.*?)\))?$/);
      if (match) {
        const [, role, name, details] = match;
        
        if (!foundersMap.has(name)) {
          foundersMap.set(name, {
            name,
            role: role === 'CEO' ? 'CEO' : 'Founder',
            background: details || '',
            linkedinUrl: null,
            email: null,
            phone: null
          });
        }
      }
    }

    const founders = Array.from(foundersMap.values());
    console.log('Extracted founders:', founders);
    console.log('Company info:', companyInfo);
    
    return {
      founders,
      company_info: companyInfo
    };

  } catch (error) {
    console.error('Error extracting founder data:', error.message);
    return {
      founders: [],
      company_info: {
        founding_year: '',
        location: ''
      }
    };
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

// Add new function to get company website and analyze its content
async function getCompanyWebsiteInfo(companyName) {
  console.log('\n=== Getting Company Website Info ===');
  try {
    // First, find the company website
    const websiteQuery = `${companyName} company official website -site:linkedin.com -site:crunchbase.com -site:bloomberg.com`;
    const websiteResults = await exa.search(websiteQuery, {
      numResults: 3,
      useAutoprompt: false,
      type: 'keyword'
    });

    if (!websiteResults?.results?.length) {
      return null;
    }

    // Look for official website in results
    const officialSite = websiteResults.results.find(result => {
      const url = result.url.toLowerCase();
      return !url.includes('linkedin.com') && 
             !url.includes('crunchbase.com') && 
             !url.includes('bloomberg.com') &&
             !url.includes('facebook.com') &&
             !url.includes('twitter.com');
    });

    if (!officialSite) {
      return null;
    }

    console.log('Found company website:', officialSite.url);

    // Search for leadership/team/about page content
    const aboutQuery = `site:${officialSite.url} (about OR team OR leadership OR management OR founders) (founder OR ceo OR executive)`;
    const aboutResults = await exa.search(aboutQuery, {
      numResults: 5,
      useAutoprompt: false,
      type: 'keyword'
    });

    if (!aboutResults?.results?.length) {
      return null;
    }

    return {
      website: officialSite.url,
      content: aboutResults.results.map(r => r.text).join('\n')
    };
  } catch (error) {
    console.error('Error getting company website info:', error);
    return null;
  }
}

// Add function to search Crunchbase
async function searchCrunchbase(companyName) {
  console.log('\n=== Searching Crunchbase ===');
  try {
    const query = `site:crunchbase.com/organization ${companyName} (founder OR ceo)`;
    const results = await exa.search(query, {
      numResults: 2,
      useAutoprompt: false,
      type: 'keyword'
    });

    if (!results?.results?.length) {
      return null;
    }

    const crunchbaseData = results.results[0];
    console.log('Found Crunchbase data:', crunchbaseData.url);
    return crunchbaseData.text;
  } catch (error) {
    console.error('Error searching Crunchbase:', error);
    return null;
  }
}

async function verifyFounder(companyName, potentialFounder) {
  // Website search
  const websiteResults = await exa.search(
    `${companyName} ${potentialFounder} founder OR CEO`,
    { numResults: 3, useAutoprompt: false, type: 'keyword' }
  );

  // News search
  const newsResults = await exa.search(
    `${companyName} ${potentialFounder} founder OR CEO site:linkedin.com OR site:crunchbase.com`,
    { numResults: 3, useAutoprompt: false, type: 'keyword' }
  );
}

async function verifyLinkedInProfile(url, founderName, companyName) {
  const response = await exa.search(
    `${founderName} ${companyName} site:linkedin.com/in/`,
    { numResults: 1 }
  );
} 