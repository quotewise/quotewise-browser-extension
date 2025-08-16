console.log('Test popup starting...');

// Add debugging for tweet type
let requestCount = 0;

// Check if runtime is available
if (chrome.runtime) {
    console.log('Chrome runtime available');
} else {
    console.error('Chrome runtime not available');
    document.getElementById('status').textContent = 'Error: Chrome runtime not available';
}

// Test direct communication with service worker
requestCount++;
console.log('Sending GET_TWEET_DATA request #' + requestCount);

chrome.runtime.sendMessage({ type: 'GET_TWEET_DATA' }, (response) => {
    console.log('Response:', response);
    console.log('Runtime last error:', chrome.runtime.lastError);
    
    const status = document.getElementById('status');
    const tweetData = document.getElementById('tweet-data');
    
    if (chrome.runtime.lastError) {
        status.textContent = `Connection Error: ${chrome.runtime.lastError.message}`;
        return;
    }
    
    if (response && response.success && response.data) {
        status.textContent = 'Tweet data loaded!';
        tweetData.style.display = 'block';
        tweetData.innerHTML = `
            <div class="tweet-data">
                <div class="author">@${response.data.author.username} - ${response.data.author.displayName}</div>
                <div class="text">"${response.data.text}"</div>
                <div class="metrics">
                    ❤️ ${response.data.likes} | 🔁 ${response.data.retweets} | 💬 ${response.data.replies}
                </div>
                <div class="metrics">Type: ${response.data.tweetType}</div>
            </div>
        `;
    } else {
        status.textContent = `Error: ${response?.error || 'No response from service worker'}`;
    }
});

// Add API testing functionality
document.getElementById('test-auth').addEventListener('click', () => {
    console.log('Testing auth status...');
    const authResult = document.getElementById('auth-result');
    authResult.style.display = 'block';
    authResult.textContent = 'Checking authentication...';
    
    chrome.runtime.sendMessage({ type: 'CHECK_AUTH_STATUS' }, (response) => {
        console.log('Auth response:', response);
        
        if (chrome.runtime.lastError) {
            authResult.innerHTML = `<strong>Error:</strong> ${chrome.runtime.lastError.message}`;
            return;
        }
        
        if (response) {
            const authInfo = response.authenticated 
                ? `✅ Authenticated as ${response.user?.username || 'user'}` 
                : '❌ Not authenticated';
            
            authResult.innerHTML = `
                <strong>Auth Status:</strong> ${authInfo}<br>
                <strong>Response:</strong> <pre>${JSON.stringify(response, null, 2)}</pre>
            `;
        } else {
            authResult.textContent = 'No response received';
        }
    });
});

// Add originator search testing
document.getElementById('test-search').addEventListener('click', () => {
    const query = document.getElementById('search-query').value.trim();
    if (!query) {
        alert('Please enter a search query');
        return;
    }
    
    console.log('Testing originator search for:', query);
    const searchResult = document.getElementById('search-result');
    searchResult.style.display = 'block';
    searchResult.textContent = 'Searching...';
    
    chrome.runtime.sendMessage({ 
        type: 'SEARCH_ORIGINATORS', 
        data: { query: query, limit: 5 } 
    }, (response) => {
        console.log('Search response:', response);
        
        if (chrome.runtime.lastError) {
            searchResult.innerHTML = `<strong>Error:</strong> ${chrome.runtime.lastError.message}`;
            return;
        }
        
        if (response && response.success) {
            const results = response.results || [];
            if (results.length > 0) {
                const resultsList = results.map(result => 
                    `<div style="margin: 5px 0; padding: 5px; border: 1px solid #eee;">
                        <strong>${result.full_name}</strong> (${result.unique_id})<br>
                        <small>Confidence: ${result.confidence || 'N/A'}</small>
                    </div>`
                ).join('');
                
                searchResult.innerHTML = `
                    <strong>Found ${results.length} result(s):</strong><br>
                    ${resultsList}
                `;
            } else {
                searchResult.innerHTML = '<strong>No results found</strong>';
            }
        } else {
            searchResult.innerHTML = `<strong>Error:</strong> ${response?.error || 'Search failed'}`;
        }
    });
});

// Add duplicate checking testing  
document.getElementById('test-duplicate').addEventListener('click', () => {
    const text = document.getElementById('quote-text').value.trim();
    if (!text) {
        alert('Please enter quote text');
        return;
    }
    
    console.log('Testing duplicate check for:', text);
    const duplicateResult = document.getElementById('duplicate-result');
    duplicateResult.style.display = 'block';
    duplicateResult.textContent = 'Checking for duplicates...';
    
    chrome.runtime.sendMessage({ 
        type: 'CHECK_DUPLICATE', 
        data: { text: text } 
    }, (response) => {
        console.log('Duplicate check response:', response);
        
        if (chrome.runtime.lastError) {
            duplicateResult.innerHTML = `<strong>Error:</strong> ${chrome.runtime.lastError.message}`;
            return;
        }
        
        if (response && response.success) {
            const recommendation = response.recommendation || 'unknown';
            const confidence = response.confidence || 0;
            const matches = response.matches || [];
            
            let matchesHtml = '';
            if (matches.length > 0) {
                matchesHtml = matches.map(match => 
                    `<div style="margin: 5px 0; padding: 5px; border: 1px solid #eee;">
                        <strong>Similarity:</strong> ${(match.similarity || 0).toFixed(1)}%<br>
                        <strong>Text:</strong> "${match.text || 'N/A'}"<br>
                        <small>Match type: ${match.match_type || 'unknown'}</small>
                    </div>`
                ).join('');
            }
            
            duplicateResult.innerHTML = `
                <strong>Recommendation:</strong> ${recommendation}<br>
                <strong>Confidence:</strong> ${(confidence * 100).toFixed(1)}%<br>
                <strong>Matches found:</strong> ${matches.length}<br>
                ${matchesHtml}
                <small>Reasoning: ${response.reasoning || 'N/A'}</small>
            `;
        } else {
            duplicateResult.innerHTML = `<strong>Error:</strong> ${response?.error || 'Duplicate check failed'}`;
        }
    });
});