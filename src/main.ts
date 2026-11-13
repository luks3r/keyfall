import { mount } from 'svelte'
import App from './App.svelte'
import './app.css'
import { isMac, isNative } from './lib/platform'

document.documentElement.classList.toggle('mac-native', isNative && isMac)

export default mount(App, { target: document.getElementById('app')! })
