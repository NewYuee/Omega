use urlpattern::{UrlPattern, UrlPatternInit, UrlPatternMatchInput};

// Use the same Rust URLPattern parser as tauri-plugin-http, not a JS glob mock.
#[test]
fn capability_allows_custom_ports_but_only_api_paths() {
    let config: serde_json::Value = serde_json::from_str(include_str!("../capabilities/main.json")).unwrap();
    let permission = config["permissions"].as_array().unwrap().iter()
        .find(|v| v["identifier"] == "http:default").unwrap();
    let patterns: Vec<UrlPattern> = permission["allow"].as_array().unwrap().iter().map(|v| {
        let mut init = UrlPatternInit::parse_constructor_string::<regex::Regex>(v["url"].as_str().unwrap(), None).unwrap();
        init.search = Some("*".into()); init.hash = Some("*".into());
        UrlPattern::parse(init, Default::default()).unwrap()
    }).collect();
    let allowed = |s: &str| patterns.iter().any(|p| p.test(UrlPatternMatchInput::Url(url::Url::parse(s).unwrap())).unwrap());
    for value in [
        "http://127.0.0.1:4310/api/status",
        "http://omega.example.com:14310/api/status",
        "http://omega.example.com/api/events?threadId=test",
        "https://omega.example.com/api/status",
        "https://omega.example.com:8443/api/images/abc?size=thumb",
        "http://[::1]:4310/api/status",
    ] { assert!(allowed(value), "must allow {value}"); }
    for value in ["file:///tmp/api/status","https://omega.example.com/private","https://omega.example.com/","ftp://omega.example.com/api/status"] {
        assert!(!allowed(value), "must reject {value}");
    }
}

#[test]
fn opener_uses_globs_not_http_urlpatterns() {
    let config: serde_json::Value = serde_json::from_str(include_str!("../capabilities/main.json")).unwrap();
    let permission = config["permissions"].as_array().unwrap().iter()
        .find(|v| v["identifier"] == "opener:allow-open-url").unwrap();
    let patterns: Vec<glob::Pattern> = permission["allow"].as_array().unwrap().iter()
        .map(|v| glob::Pattern::new(v["url"].as_str().unwrap()).unwrap()).collect();
    for s in ["https://example.com/","https://example.com:8443/path","http://127.0.0.1:4310/"] {
        assert!(patterns.iter().any(|p| p.matches(s)));
    }
    for s in ["file:///tmp","javascript:alert(1)"] {
        assert!(!patterns.iter().any(|p| p.matches(s)));
    }
}
