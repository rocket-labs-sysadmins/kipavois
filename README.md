# KiPavois

KiPavois is an HTTP proxy rewriting Elasticsearch queries made by Kibana 4
to provide data isolation across different users.

To use this, you need an upstream application taking care of authentication,
and that specify a special HTTP header (by default `x-kibana-user`) expected by
KiPavois.

## Behavior

### Filters

A new filter is added to queries specified in the body of `POST /_msearch`
operation.

### Permission denied

It is not possible to:

* update Kibana configuration
* create, update, or remove dashboards.

## License

`KiPavois` is licensed under the Apache License, Version 2.0.
See [LICENSE](LICENSE) file for full license text.
