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
        console.log(`Getting company data for: ${companyName}`);
        
        const options = {
            method: 'POST',
            url: 'https://api.perplexity.ai/chat/completions',
            headers: {
                'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
                'Content-Type': 'application/json'
            },
            data: {
                model: "sonar-pro",
                messages: [
                    {
                        role: "system",
                        content: "You are a company research expert. Return ONLY JSON without any additional text."
                    },
                    {
                        role: "user",
                        content: `Find information about ${companyName} and return in this EXACT JSON format (no additional text):
                        {
                            "companyName": "full company name",
                            "website": "company website URL or null",
                            "founders": [
                                {
                                    "name": "founder full name",
                                    "role": "founder role (CEO, Co-Founder, etc.)"
                                }
                            ],
                            "yearFounded": "founding year",
                            "location": "headquarters location"
                        }
                        
                        Important: 
                        1. Include ALL founders
                        2. Use ONLY this format
                        3. Return ONLY valid JSON
                        4. Do not include notes, disclaimers or any additional text`
                    }
                ],
                temperature: 0.1,
                max_tokens: 1024
            },
            timeout: 20000
        };

        console.log('Sending request to Perplexity API...');
        const response = await axios(options);
        
        if (!response.data?.choices?.[0]?.message?.content) {
            throw new Error('Invalid response from Perplexity API');
        }

        const content = response.data.choices[0].message.content.trim();
        console.log('Perplexity raw response:', content);

        try {
            // Try to parse JSON directly from the content
            // First clean up any markdown formatting or extra text
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            const jsonStr = jsonMatch ? jsonMatch[0] : content;
            const parsedData = JSON.parse(jsonStr);
            console.log('Parsed company data:', parsedData);
            
            // Ensure we have the expected structure with defaults
            return {
                companyName: parsedData.companyName || companyName,
                website: parsedData.website || 'Not Found',
                founders: Array.isArray(parsedData.founders) ? parsedData.founders : [],
                yearFounded: parsedData.yearFounded || 'Not Found',
                location: parsedData.location || 'Not Found'
            };
        } catch (parseError) {
            console.error('Error parsing JSON response:', parseError);
            
            // Fallback to a default structure if parsing fails
            return {
                companyName: companyName,
                website: 'Not Found',
                founders: [],
                yearFounded: 'Not Found',
                location: 'Not Found'
            };
        }
    } catch (error) {
        console.error('Error in getCompanyData:', error);
        throw new Error(`Failed to get company data: ${error.message}`);
    }
}

// 2. Extract structured data using Groq
async function extractFounderData(text) {
    try {
        console.log('Extracting founder data from text...');
        
        const prompt = `Extract the following information from the text as JSON. Return ONLY the JSON, no additional text or notes:
        {
            "companyName": "full company name",
            "website": "website or null",
            "yearFounded": "year or null",
            "location": "location or null",
            "founders": [
                {
                    "name": "founder full name",
                    "role": "founder role",
                    "yearJoined": null
                }
            ]
        }`;

        const completion = await groqClient.chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: 'You are a JSON formatter. Return only valid JSON without any additional text or notes.'
                },
                {
                    role: 'user',
                    content: `Format this information as JSON:\n${text}\n\nFormat: ${prompt}`
                }
            ],
            model: 'mixtral-8x7b-32768',
            temperature: 0.1,
            max_tokens: 2048
        });

        const response = completion.choices[0].message.content;
        console.log('Raw GROQ response:', response);

        // Clean the response to ensure it's valid JSON
        const cleanedResponse = response.replace(/[\r\n\t]/g, '').trim();
        const startIndex = cleanedResponse.indexOf('{');
        const endIndex = cleanedResponse.lastIndexOf('}') + 1;
        const jsonStr = cleanedResponse.slice(startIndex, endIndex);

        try {
            return JSON.parse(jsonStr);
        } catch (parseError) {
            console.error('Error parsing cleaned JSON:', parseError);
            // Attempt to parse the response differently if the first attempt fails
            const fallbackData = {
                companyName: text.match(/Company Name:?\s*([^\n]+)/i)?.[1] || null,
                website: text.match(/Website:?\s*([^\n]+)/i)?.[1] || null,
                yearFounded: text.match(/Founded:?\s*(\d{4})/i)?.[1] || null,
                location: text.match(/Location:?\s*([^\n]+)/i)?.[1] || null,
                founders: []
            };

            // Extract founders using regex
            const foundersMatch = text.match(/Founders?:?\s*([^\n]+)/i);
            if (foundersMatch) {
                const foundersText = foundersMatch[1];
                const foundersList = foundersText.split(/,|and/).map(f => f.trim());
                fallbackData.founders = foundersList.map(name => ({
                    name: name,
                    role: "Founder",
                    yearJoined: null
                }));
            }

            return fallbackData;
        }
    } catch (error) {
        console.error('Error in extractFounderData:', error);
        throw new Error('Failed to extract structured data');
    }
}

// Update the findLinkedInProfile function with better search strategy
async function findLinkedInProfile(founderName, companyName) {
    try {
        console.log(`Searching LinkedIn profile for: ${founderName} (${companyName})`);
        
        // Clean the search terms
        const cleanName = founderName.trim().replace(/[^\w\s]/g, '');
        const cleanCompany = companyName.trim().replace(/[^\w\s]/g, '');

        // Try different search strategies
        const searchQueries = [
            `${cleanName} ${cleanCompany} founder linkedin profile`,
            `${cleanName} ${cleanCompany} co-founder`,
            `${cleanName} linkedin ${cleanCompany}`
        ];
        
        for (const query of searchQueries) {
            try {
                console.log(`Trying Exa search with: "${query}"`);
                
                // Using a simpler configuration that works with Exa API
                const searchResults = await exa.search(query, {
                    numResults: 5,
                    siteSearch: "linkedin.com" // Use siteSearch instead of domains
                });
                
                console.log(`Found ${searchResults?.results?.length || 0} results`);
                
                if (searchResults?.results?.length > 0) {
                    // Filter for LinkedIn profile pages
                    const profileUrls = searchResults.results
                        .filter(result => {
                            const url = result.url?.toLowerCase() || '';
                            return url.includes('linkedin.com/in/') && 
                                  !url.includes('/company/') && 
                                  !url.includes('/jobs/');
                        })
                        .map(result => ({
                            url: result.url,
                            title: result.title || '',
                            snippet: result.snippet || ''
                        }));
                    
                    if (profileUrls.length > 0) {
                        console.log(`Found ${profileUrls.length} LinkedIn profiles`);
                        
                        // Score each profile based on relevance
                        const scoredProfiles = profileUrls.map(profile => {
                            const score = scoreLinkedInProfile(profile, cleanName, cleanCompany);
                            return { ...profile, score };
                        });
                        
                        // Sort by score
                        scoredProfiles.sort((a, b) => b.score - a.score);
                        
                        if (scoredProfiles[0].score >= 4) {
                            // Clean and format the URL
                            const profileUrl = cleanLinkedInUrl(scoredProfiles[0].url);
                            console.log(`Found LinkedIn profile: ${profileUrl}`);
                            return profileUrl;
                        }
                    }
                }
            } catch (error) {
                console.error('Exa search error:', error.message);
            }
            
            // Wait before trying next query to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        console.log(`No LinkedIn profile found for ${founderName}`);
        return 'Not Found';
    } catch (error) {
        console.error(`Error finding LinkedIn profile for ${founderName}:`, error);
        return 'Not Found';
    }
}

// Helper function to clean LinkedIn URLs
function cleanLinkedInUrl(url) {
    try {
        const urlObj = new URL(url);
        // Extract just the /in/username part without query parameters
        if (urlObj.pathname.includes('/in/')) {
            const username = urlObj.pathname.split('/in/')[1].split(/[?#]/)[0];
            return `https://www.linkedin.com/in/${username}`;
        }
        return url;
    } catch (e) {
        return url;
    }
}

// Helper function to score LinkedIn profiles for relevance
function scoreLinkedInProfile(profile, founderName, companyName) {
    let score = 0;
    const content = `${profile.title} ${profile.snippet}`.toLowerCase();
    const url = profile.url.toLowerCase();
    
    // Name matching (most important)
    const nameWords = founderName.toLowerCase().split(' ');
    nameWords.forEach(word => {
        if (word.length > 2 && content.includes(word)) {
            score += 2;
            if (url.includes(word)) score += 2; // Bonus if name is in URL
        }
    });
    
    // Company matching
    const companyWords = companyName.toLowerCase().split(' ');
    companyWords.forEach(word => {
        if (word.length > 2 && content.includes(word)) {
            score += 1.5;
        }
    });
    
    // Role keywords
    const roles = ['founder', 'co-founder', 'ceo', 'chief', 'partner', 'managing'];
    roles.forEach(role => {
        if (content.includes(role)) {
            score += 1;
        }
    });
    
    console.log(`Profile score for ${url}: ${score}`);
    return score;
}

// Update the contact info retrieval functions
async function getFounderEmail(linkedinUrl) {
    if (!linkedinUrl || linkedinUrl === 'Not Found') {
        return { email: 'Not Found' };
    }
    
    try {
        console.log('Searching email for LinkedIn profile:', linkedinUrl);
        
        const response = await axios({
            method: 'POST',
            url: 'https://api.prospeo.io/social-url-enrichment',
            headers: {
                'Content-Type': 'application/json',
                'X-KEY': process.env.PROSPEO_API_KEY
            },
            data: { url: linkedinUrl },
            timeout: 20000
        });

        console.log('Prospeo email API response status:', response.status);

        if (response.data?.error === false && response.data?.response?.email?.email) {
            const email = response.data.response.email.email;
            console.log('Found email:', email);
            return { email };
        } else if (response.data?.error === false && response.data?.response?.email?.value) {
            // Alternative response format
            const email = response.data.response.email.value;
            console.log('Found email (alternative format):', email);
            return { email };
        }
        
        console.log('No email found in Prospeo response');
        return { email: 'Not Found' };
    } catch (error) {
        // Check for insufficient credits error
        if (error.response?.data?.message === 'INSUFFICIENT_CREDITS') {
            console.log('⚠️ Prospeo API: Insufficient credits for email lookup');
        } else {
            console.error('Error getting email:', error.message);
            // Only log detailed error info for non-credit related errors
            if (error.response && error.response.data && error.response.data.message !== 'INSUFFICIENT_CREDITS') {
                console.error('Prospeo API error details:', {
                    status: error.response.status,
                    message: error.response.data.message
                });
            }
        }
        return { email: 'Not Found' };
    }
}

async function getFounderPhone(linkedinUrl) {
    if (!linkedinUrl || linkedinUrl === 'Not Found') {
        return { phone: 'Not Found' };
    }
    
    try {
        console.log('Searching phone for LinkedIn profile:', linkedinUrl);
        
        const response = await axios({
            method: 'POST',
            url: 'https://api.prospeo.io/mobile-finder',
            headers: {
                'Content-Type': 'application/json',
                'X-KEY': process.env.PROSPEO_API_KEY
            },
            data: { url: linkedinUrl },
            timeout: 20000
        });

        console.log('Prospeo phone API response status:', response.status);

        if (response.data?.error === false) {
            // Check different possible response formats
            if (response.data.response?.raw_format) {
                const phone = response.data.response.raw_format;
                console.log('Found phone (raw_format):', phone);
                return { phone };
            } else if (response.data.response?.phone) {
                const phone = response.data.response.phone;
                console.log('Found phone (phone field):', phone);
                return { phone };
            } else if (response.data.response?.value) {
                const phone = response.data.response.value;
                console.log('Found phone (value field):', phone);
                return { phone };
            }
        }
        
        console.log('No phone found in Prospeo response');
        return { phone: 'Not Found' };
    } catch (error) {
        // Check for insufficient credits error
        if (error.response?.data?.message === 'INSUFFICIENT_CREDITS') {
            console.log('⚠️ Prospeo API: Insufficient credits for phone lookup');
        } else {
            console.error('Error getting phone:', error.message);
            // Only log detailed error info for non-credit related errors
            if (error.response && error.response.data && error.response.data.message !== 'INSUFFICIENT_CREDITS') {
                console.error('Prospeo API error details:', {
                    status: error.response.status,
                    message: error.response.data.message
                });
            }
        }
        return { phone: 'Not Found' };
    }
}

// 4. Main research function
export async function researchCompany(companyName) {
    console.log(`\n=== Researching Company: ${companyName} ===`);
    
    try {
        // Step 1: Get company information from Perplexity
        const companyData = await getCompanyData(companyName);
        console.log('Company information found:', {
            name: companyData.companyName,
            website: companyData.website,
            foundedYear: companyData.yearFounded,
            founders: companyData.founders ? companyData.founders.length : 0
        });

        // Early return if no founders found
        if (!companyData?.founders?.length) {
            return {
                companyName: companyData.companyName || companyName,
                foundersData: [{
                    name: 'Not Found',
                    role: 'Not Found',
                    linkedinUrl: 'Not Found',
                    email: 'Not Found',
                    phone: 'Not Found'
                }],
                website: companyData.website || 'Not Found',
                yearFounded: companyData.yearFounded || 'Not Found'
            };
        }

        // Step 2: Process each founder
        const foundersData = [];
        for (const founder of companyData.founders) {
            console.log(`Processing founder: ${founder.name}`);
            
            // Initialize founder data with defaults
            const founderData = {
                name: founder.name,
                role: founder.role || 'Not Found',
                linkedinUrl: 'Not Found',
                email: 'Not Found',
                phone: 'Not Found'
            };
            
            // Step 2a: Find LinkedIn profile (with error handling)
            try {
                const linkedinUrl = await findLinkedInProfile(founder.name, companyName);
                if (linkedinUrl !== 'Not Found') {
                    founderData.linkedinUrl = linkedinUrl;
                    
                    // Add delay to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    // Step 2b: Get email (with error handling)
                    try {
                        const emailResult = await getFounderEmail(linkedinUrl);
                        founderData.email = emailResult.email || 'Not Found';
                    } catch (emailError) {
                        console.error(`Error getting email for ${founder.name}: ${emailError.message}`);
                        // Don't fail completely, just keep the default 'Not Found'
                    }
                    
                    // Wait briefly before next API call
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    // Step 2c: Get phone (with error handling)
                    try {
                        const phoneResult = await getFounderPhone(linkedinUrl);
                        founderData.phone = phoneResult.phone || 'Not Found';
                    } catch (phoneError) {
                        console.error(`Error getting phone for ${founder.name}: ${phoneError.message}`);
                        // Don't fail completely, just keep the default 'Not Found'
                    }
                }
            } catch (linkedinError) {
                console.error(`Error finding LinkedIn for ${founder.name}: ${linkedinError.message}`);
                // Don't fail completely, just keep the default 'Not Found'
            }
            
            // Add founder to results (regardless of errors)
            foundersData.push(founderData);
            
            // Brief pause between founders to avoid rate limits
            if (companyData.founders.length > 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        // Return the complete result
        return {
            companyName: companyData.companyName,
            foundersData,
            website: companyData.website || 'Not Found',
            yearFounded: companyData.yearFounded || 'Not Found'
        };

    } catch (error) {
        console.error(`Error in researchCompany: ${error.message}`);
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