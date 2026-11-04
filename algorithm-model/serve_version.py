"""Serve one model on the container's assigned IPv4 interface, never a wildcard."""
from ipaddress import IPv4Address
import socket


def container_bind_address() -> str:
    addresses = {
        IPv4Address(sockaddr[0])
        for _, _, _, _, sockaddr in socket.getaddrinfo(
            socket.gethostname(), None, family=socket.AF_INET, type=socket.SOCK_STREAM,
        )
    }
    if len(addresses) != 1:
        raise RuntimeError("Model container must resolve to exactly one IPv4 interface")
    address = addresses.pop()
    if address.is_unspecified or address.is_loopback or address.is_multicast or address.is_reserved or address.is_link_local:
        raise RuntimeError("Model container requires an assigned unicast IPv4 interface")
    return str(address)


def main() -> None:
    # Resolve before loading GPU libraries/models. No wildcard fallback on error.
    host = container_bind_address()
    import uvicorn
    uvicorn.run("version_server:app", host=host, port=9002)


if __name__ == "__main__":
    main()
