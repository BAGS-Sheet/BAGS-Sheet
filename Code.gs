var scriptProperties = PropertiesService.getScriptProperties();

function doGet() {
    return HtmlService.createHtmlOutputFromFile('Index')
        .setTitle('Bluesky Hashtag Monitor');
}

function saveUserCredentials(username, password, hashtags) {
    scriptProperties.setProperty("blueskyUsername", username);
    scriptProperties.setProperty("blueskyPassword", password);
    
    // Ensure hashtags start with #
    var formattedHashtags = hashtags.map(tag => tag.startsWith("#") ? tag : "#" + tag);
    scriptProperties.setProperty("hashtags", formattedHashtags.join(",")); // Store as CSV

    var spreadsheet = SpreadsheetApp.create("Bluesky Hashtag Data");
    scriptProperties.setProperty("spreadsheetId", spreadsheet.getId());

    fetchBlueskyPosts(); // Run immediately

    ScriptApp.newTrigger("fetchBlueskyPosts")
        .timeBased()
        .everyMinutes(5) // Updates every 5 minutes
        .create();

    return spreadsheet.getUrl();
}

function fetchBlueskyPosts() {
    var username = scriptProperties.getProperty("blueskyUsername");
    var password = scriptProperties.getProperty("blueskyPassword");
    var hashtags = scriptProperties.getProperty("hashtags").split(",");
    var spreadsheetId = scriptProperties.getProperty("spreadsheetId");

    if (!username || !password || !hashtags || !spreadsheetId) {
        Logger.log("Missing user settings. Stopping execution.");
        return;
    }

    var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    var sheet = spreadsheet.getActiveSheet();
    ensureHeaders(sheet);

    var authToken = getBlueskyAuthToken(username, password);
    if (!authToken) {
        Logger.log("Authentication failed.");
        return;
    }

    var headers = {
        "Authorization": "Bearer " + authToken,
        "Content-Type": "application/json"
    };

    hashtags.forEach(function(hashtag) {
        var url = "https://bsky.social/xrpc/app.bsky.feed.searchPosts?q=" + encodeURIComponent(hashtag);
        var options = {
            "method": "get",
            "headers": headers,
            "muteHttpExceptions": true
        };

        try {
            var response = UrlFetchApp.fetch(url, options);
            var json = JSON.parse(response.getContentText());

            if (json.error) {
                Logger.log("API Error: " + json.message);
                return;
            }

            if (json.posts && json.posts.length > 0) {
                json.posts.forEach(function(post) {
                    var postUrl = "https://bsky.app/profile/" + post.author.handle + "/post/" + post.uri.split("/").pop();
                    var displayName = post.author.displayName || "Unknown";
                    var handle = post.author.handle || "Unknown";
                    var postText = post.record.text ? post.record.text.replace(/\s+/g, " ").trim() : "No Text";

                    sheet.appendRow([new Date(), hashtag, handle, displayName, postText, postUrl]);
                });
            } else {
                Logger.log("No new posts for hashtag: " + hashtag);
            }
        } catch (error) {
            Logger.log("Error fetching posts: " + error);
        }
    });
}

function ensureHeaders(sheet) {
    var headers = ["Date", "Hashtag", "Handle", "Name", "Post Text", "Post URL"];
    if (sheet.getLastRow() === 0 || sheet.getRange(1, 1, 1, headers.length).getValues()[0].some(cell => !headers.includes(cell))) {
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
}

function getBlueskyAuthToken(username, password) {
    var url = "https://bsky.social/xrpc/com.atproto.server.createSession";
    var payload = { "identifier": username, "password": password };
    var options = { "method": "post", "contentType": "application/json", "payload": JSON.stringify(payload), "muteHttpExceptions": true };

    try {
        var response = UrlFetchApp.fetch(url, options);
        var json = JSON.parse(response.getContentText());

        if (json.error) {
            Logger.log("Authentication Error: " + json.message);
            return null;
        }

        return json.accessJwt;
    } catch (error) {
        Logger.log("Error retrieving authentication token: " + error);
        return null;
    }
}