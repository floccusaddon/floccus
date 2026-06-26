<template>
  <div class="native-scroll-container">
    <Drawer :visible.sync="drawer" />
    <v-app-bar
      fixed
      app>
      <v-app-bar-nav-icon
        class="mr-2 ml-n2"
        @click="drawer = !drawer" />
      <v-app-bar-title
        role="heading"
        aria-level="1">{{ t('LabelAbout') }}</v-app-bar-title>
    </v-app-bar>
    <v-main>
      <v-container>
        <v-card>
          <v-container class="pa-5">
            <v-card-title
              role="heading"
              aria-level="2">
              {{ t("LabelCurrentversion") }}
            </v-card-title>
            <v-card-text>
              <p>{{ t("DescriptionCurrentversion") }}</p>
              <p>v{{ VERSION }}</p>
            </v-card-text>
          </v-container>
        </v-card>
        <v-card
          class="mt-3 mb-16">
          <v-container class="pa-5">
            <v-card-title
              role="heading"
              aria-level="2">
              {{ t("LabelContributors") }}
            </v-card-title>
            <v-card-text>
              <p>{{ t("DescriptionContributors") }}</p>
              <div
                v-for="contributor in CONTRIBUTORS"
                :key="contributor.name">
                <h4 class="mt-2">
                  <a
                    class="name"
                    :href="contributor.profile">{{ contributor.name }}</a>
                </h4>
                <span
                  v-for="type in contributor.contributions"
                  :key="type"
                  :title="CONTRIBUTION_TYPES[type].description">{{ CONTRIBUTION_TYPES[type].symbol }} {{ CONTRIBUTION_TYPES[type].description }}&nbsp;&nbsp;</span>
              </div>
            </v-card-text>
          </v-container>
        </v-card>
      </v-container>
    </v-main>
  </div>
</template>

<script>
import Drawer from '../../components/native/Drawer'
import { version as VERSION } from '../../../../package.json'
import { contributors as CONTRIBUTORS } from 'json-loader!../../../../.all-contributorsrc'

export default {
  name: 'About',
  components: { Drawer},
  data() {
    return {
      drawer: false,
      VERSION,
      CONTRIBUTORS: CONTRIBUTORS.sort((a,b) => b.contributions.length - a.contributions.length),
      CONTRIBUTION_TYPES
    }
  }
}

const CONTRIBUTION_TYPES = {
  a11y: {
    symbol: '️️️️♿️',
    description: 'Accessibility',
  },
  audio: {
    symbol: '🔊',
    description: 'Audio',
  },
  blog: {
    symbol: '📝',
    description: 'Blogposts',
  },
  bug: {
    symbol: '🐛',
    description: 'Bug reports',
  },
  business: {
    symbol: '💼',
    description: 'Business development',
  },
  code: {
    symbol: '💻',
    description: 'Code',
  },
  content: {
    symbol: '🖋',
    description: 'Content',
  },
  data: {
    symbol: '🔣',
    description: 'Data',
  },
  design: {
    symbol: '🎨',
    description: 'Design',
  },
  doc: {
    symbol: '📖',
    description: 'Documentation',
  },
  eventOrganizing: {
    symbol: '📋',
    description: 'Event Organizing',
  },
  example: {
    symbol: '💡',
    description: 'Examples',
  },
  financial: {
    symbol: '💵',
    description: 'Financial',
  },
  fundingFinding: {
    symbol: '🔍',
    description: 'Funding Finding',
  },
  ideas: {
    symbol: '🤔',
    description: 'Ideas, Planning, & Feedback',
  },
  infra: {
    symbol: '🚇',
    description: 'Infrastructure (Hosting, Build-Tools, etc)',
  },
  maintenance: {
    symbol: '🚧',
    description: 'Maintenance',
  },
  mentoring: {
    symbol: '🧑‍🏫',
    description: 'Mentoring',
  },
  platform: {
    symbol: '📦',
    description: 'Packaging/porting to new platform',
  },
  plugin: {
    symbol: '🔌',
    description: 'Plugin/utility libraries',
  },
  projectManagement: {
    symbol: '📆',
    description: 'Project Management',
  },
  question: {
    symbol: '💬',
    description: 'Answering Questions',
  },
  research: {
    symbol: '🔬',
    description: 'Research',
  },
  review: {
    symbol: '👀',
    description: 'Reviewed Pull Requests',
  },
  security: {
    symbol: '🛡️',
    description: 'Security',
  },
  talk: {
    symbol: '📢',
    description: 'Talks',
  },
  test: {
    symbol: '⚠️',
    description: 'Tests',
  },
  tool: {
    symbol: '🔧',
    description: 'Tools',
  },
  translation: {
    symbol: '🌍',
    description: 'Translation',
  },
  tutorial: {
    symbol: '✅',
    description: 'Tutorials',
  },
  userTesting: {
    symbol: '📓',
    description: 'User Testing',
  },
  video: {
    symbol: '📹',
    description: 'Videos',
  },
}
</script>

<style scoped>

</style>
