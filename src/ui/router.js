import Vue from 'vue'
import Router from 'vue-router'
import Overview from './views/Overview'
import AccountOptions from './views/AccountOptions'
import NewAccount from './views/NewAccount'
import SetKey from './views/SetKey'
import Update from './views/Update'

Vue.use(Router)

export const routes = {
  OVERVIEW: 'OVERVIEW',
  ACCOUNT_OPTIONS: 'ACCOUNT_OPTIONS',
  NEW_ACCOUNT: 'NEW_ACCOUNT',
  SET_KEY: 'SET_KEY',
  FUNDING: 'FUNDING',
  UPDATE: 'UPDATE',
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
      component: AccountOptions,
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
  ],
})
