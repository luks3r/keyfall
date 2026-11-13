(() => {
        let preference = 'system';
        try { preference = JSON.parse(localStorage.getItem('keyfall.settings.v2') || '{}').theme; } catch {}
        const resolved = preference === 'light' || preference === 'dark' ? preference : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        document.documentElement.dataset.theme = resolved;
        document.documentElement.style.colorScheme = resolved;
      })();
