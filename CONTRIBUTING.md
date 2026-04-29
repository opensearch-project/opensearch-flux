# Contributing to OpenSearch Flux

We welcome contributions from the community. Every contribution matters, whether it's a bug report, feature request, documentation improvement, or code change.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/your-username/opensearch-flux.git`
3. Set up the development environment:
   ```bash
   cd src
   npm install
   npx tsc
   ```
4. Run tests: `npm test`

## Development

### Building

```bash
cd src
npx tsc
```

### Running Tests

```bash
cd src
npm test
```

### Code Style

- TypeScript with strict mode enabled
- ES modules (`"type": "module"`)
- Use `vitest` for testing

## Submitting Changes

1. Create a feature branch: `git checkout -b my-feature`
2. Make your changes
3. Run tests to make sure nothing is broken: `npm test`
4. Commit with a descriptive message
5. Push to your fork and open a pull request

## Reporting Issues

- Use GitHub Issues to report bugs or request features
- Include steps to reproduce for bug reports
- Include the OpenSearch version and endpoint type (AOS, AOSS, OpenSearch UI, self-managed)

## Code of Conduct

This project has adopted the [Amazon Open Source Code of Conduct](https://aws.github.io/code-of-conduct). For more information see the [Code of Conduct FAQ](https://aws.github.io/code-of-conduct-faq).

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
