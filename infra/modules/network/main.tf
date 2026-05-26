# Network module: VPC with public + private subnets in two AZs.
#
# Layout:
#   - Public subnets host NAT gateways and (in the public-internet variant)
#     the ALB. Routes 0.0.0.0/0 to the IGW.
#   - Private subnets host ECS tasks and RDS. No direct internet route;
#     egress goes via NAT in the same AZ.
#   - Two AZs is the cheapest config that survives a single-AZ failure, which
#     is the only failure mode this module is responsible for (multi-region
#     is an explicit DR concern handled elsewhere).
#
# Single NAT vs per-AZ NAT: per-AZ is correct for production (loss of one AZ
# shouldn't kill egress from the other), single-NAT is cheaper for staging
# (~$32/mo vs ~$64/mo). Controlled by var.single_nat.

terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.50" }
  }
}

variable "name_prefix" { type = string }
variable "environment" { type = string }
variable "cidr_block"  { type = string  default = "10.40.0.0/16" }
variable "azs"         { type = list(string) }
variable "single_nat"  { type = bool   default = false }
variable "tags"        { type = map(string) default = {} }

locals {
  public_subnet_cidrs  = [for i in range(length(var.azs)) : cidrsubnet(var.cidr_block, 4, i)]
  private_subnet_cidrs = [for i in range(length(var.azs)) : cidrsubnet(var.cidr_block, 4, i + 8)]
  tags = merge(var.tags, { Module = "network" })
}

resource "aws_vpc" "this" {
  cidr_block           = var.cidr_block
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags                 = merge(local.tags, { Name = "${var.name_prefix}-vpc" })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = merge(local.tags, { Name = "${var.name_prefix}-igw" })
}

resource "aws_subnet" "public" {
  count                   = length(var.azs)
  vpc_id                  = aws_vpc.this.id
  cidr_block              = local.public_subnet_cidrs[count.index]
  availability_zone       = var.azs[count.index]
  map_public_ip_on_launch = false
  tags = merge(local.tags, {
    Name = "${var.name_prefix}-public-${var.azs[count.index]}"
    Tier = "public"
  })
}

resource "aws_subnet" "private" {
  count             = length(var.azs)
  vpc_id            = aws_vpc.this.id
  cidr_block        = local.private_subnet_cidrs[count.index]
  availability_zone = var.azs[count.index]
  tags = merge(local.tags, {
    Name = "${var.name_prefix}-private-${var.azs[count.index]}"
    Tier = "private"
  })
}

resource "aws_eip" "nat" {
  count  = var.single_nat ? 1 : length(var.azs)
  domain = "vpc"
  tags   = merge(local.tags, { Name = "${var.name_prefix}-nat-eip-${count.index}" })
}

resource "aws_nat_gateway" "this" {
  count         = var.single_nat ? 1 : length(var.azs)
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
  tags          = merge(local.tags, { Name = "${var.name_prefix}-nat-${count.index}" })

  depends_on = [aws_internet_gateway.this]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = merge(local.tags, { Name = "${var.name_prefix}-rt-public" })
}

resource "aws_route_table_association" "public" {
  count          = length(var.azs)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  count  = length(var.azs)
  vpc_id = aws_vpc.this.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this[var.single_nat ? 0 : count.index].id
  }
  tags = merge(local.tags, { Name = "${var.name_prefix}-rt-private-${var.azs[count.index]}" })
}

resource "aws_route_table_association" "private" {
  count          = length(var.azs)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

output "vpc_id"             { value = aws_vpc.this.id }
output "public_subnet_ids"  { value = aws_subnet.public[*].id }
output "private_subnet_ids" { value = aws_subnet.private[*].id }
output "private_route_table_ids" { value = aws_route_table.private[*].id }
output "vpc_cidr_block"     { value = aws_vpc.this.cidr_block }
