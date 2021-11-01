import Vue from 'vue'
import Router from 'vue-router'
import Overview from './views/Overview'
import NewAccount from './views/NewAccount'
import SetKey from './views/SetKey'
import Update from './views/Update'
import ImportExport from './views/ImportExport'
import Donate from './views/Donate'

Vue.use(Router)

export const routes = {
  OVERVIEW: 'OVERVIEW',
  ACCOUNT_OPTIONS: 'ACCOUNT_OPTIONS',
  NEW_ACCOUNT: 'NEW_ACCOUNT',
  SET_KEY: 'SET_KEY',
  FUNDING: 'FUNDING',
  UPDATE: 'UPDATE',
  IMPORTEXPORT: 'IMPORTEXPORT',
  DONATE: 'DONATE',
}

export const router = new Router({
  linkActiveClass: 'active',
  routes: [
    {
      path: '/',
      name: routes.OVERVIEW,
      component: Overview,
    },
    {
      path: '/options/:accountId',
      name: routes.ACCOUNT_OPTIONS,
      component: () => import(/* webpackPrefetch: true */ './views/AccountOptions'),
    },
    {
      path: '/new',
      name: routes.NEW_ACCOUNT,
      component: NewAccount,
    },
    {
      path: '/set-key',
      name: routes.SET_KEY,
      component: SetKey,
    },
    {
      path: '/update',
      name: routes.UPDATE,
      component: Update,
    },
    {
      path: '/importexport',
      name: routes.IMPORTEXPORT,
      component: ImportExport,
    },
    {
      path: '/donate',
      name: routes.DONATE,
      component: Donate,
    },
  ],
})
